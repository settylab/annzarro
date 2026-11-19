"""``POST /api/v1/data/gene_score``: one score per cell for a gene signature.

The body carries the recipe (2,000 names do not fit a request line); the dataset is named, as on
every data route, by ``?dataset_path=``, which is what the access gate and the path confinement read.
A ``dataset_path`` in the body is allowed only if it names the same dataset.

Body::

    {"recipe": {...},              # core/gene_score.py: genes, input, method, clip, seed, version
                                   # (method control_adjusted draws its control genes with ``seed``)
     "subset": "<spec>" | {...},   # optional: the cells shown (as ?subset= elsewhere)
     "estimate_only": false,       # answer with the cost estimate and read nothing
     "confirm": false}             # the user accepted an estimate above ``auto_max_s``

``estimate_only`` answers ``200`` JSON ``{"estimate": {entries, seconds, tier, auto_max_s, max_s,
layout, ...}, "missing": [...], "duplicated": [...], "recipe": {...}}``. The tier is ``auto`` (compute
without asking), ``confirm`` (ask once: send ``confirm: true``) or ``refused`` (``413
score_too_expensive`` when asked to compute). Without ``confirm`` a ``confirm`` tier answers ``409
confirmation_required``.

Otherwise the reply is a stream of frames, ``application/x-annzarro-score-stream``: JSON objects,
one per line, and after the ``result`` frame ``byte_length`` bytes of little-endian float32, one
value per cell shown, in the order of the cells shown. Frames: ``progress``
``{done, total}``, then ``result`` (the vector's header, gene figures, warnings), or ``error``
``{reason, message}`` when the work fails after the stream began (the status is already 200, so a
stream that ends without a ``result`` frame has failed). A closed connection stops the work after the
read in progress. One score is computed at a time per worker; another request waits up to
``QUEUE_WAIT_S`` seconds, then answers ``503 read_busy``.
"""
import json
import logging
import threading

import numpy as np
from flask import Response, current_app as app, jsonify, request

from .. import access
from ...core import gene_score, get_reader, read_guard, remote
from ...core import subset as cell_subset
from . import data_routes

logger = logging.getLogger(__name__)

#: Body size one request may have: 2,000 names of any real length, a subset spec and a few flags.
MAX_BODY_BYTES = 1 << 20
#: Seconds a request waits for the score being computed before it answers 503.
QUEUE_WAIT_S = 30.0
#: Seconds a remote store may be read for one score (the request deadline ends with the request itself).
REMOTE_COMPUTE_S = 1800.0
#: Seconds a remote store may be sampled for the kind of an input.
REMOTE_KIND_S = 30.0
#: Bytes of the vector written at once, so a closed connection is noticed between writes.
WRITE_CHUNK = 1 << 20

MIMETYPE = "application/x-annzarro-score-stream"
_BODY_FIELDS = ("recipe", "subset", "estimate_only", "confirm", "dataset_path")

#: One computation at a time in this process.
_slot = threading.BoundedSemaphore(1)


def _error(status, reason, message, **extra):
    return jsonify({"error": message, "reason": reason, **extra}), status


def _body():
    """The request body as an object, or a (status, reason, message) refusal."""
    declared = request.content_length
    if declared is not None and declared > MAX_BODY_BYTES:
        return None, (413, "request_too_large", f"The request is over {MAX_BODY_BYTES // 2 ** 20} MB.")
    raw = request.stream.read(MAX_BODY_BYTES + 1)
    if len(raw) > MAX_BODY_BYTES:
        return None, (413, "request_too_large", f"The request is over {MAX_BODY_BYTES // 2 ** 20} MB.")
    try:
        body = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None, (400, "bad_request", "The body must be a JSON object.")
    if not isinstance(body, dict):
        return None, (400, "bad_request", "The body must be a JSON object.")
    unknown = sorted(set(body) - set(_BODY_FIELDS))
    if unknown:
        return None, (400, "bad_request", f"Unknown field(s): {', '.join(unknown)}.")
    for flag in ("estimate_only", "confirm"):
        if not isinstance(body.get(flag, False), bool):
            return None, (400, "bad_request", f"{flag} must be true or false.")
    return body, None


def _frame(obj):
    return json.dumps(obj, separators=(",", ":"), allow_nan=False).encode("utf-8") + b"\n"


def _clean(value):
    """JSON cannot hold NaN or infinity: figures that are not finite become null."""
    if isinstance(value, float) and not np.isfinite(value):
        return None
    return value


def _gene_json(stat):
    return {key: _clean(val) for key, val in stat.to_json().items()}


def _result_frame(plan, result):
    shown = result.values
    names = {"constant": [g.name for g in result.genes if g.status == "constant"],
             "no_values": [g.name for g in result.genes if g.status == "no_values"]}
    warnings = []
    if plan.missing:
        warnings.append({"code": "missing_genes", "names": plan.missing,
                         "message": f"{len(plan.missing)} gene(s) are not in this dataset and were left out."})
    if plan.duplicated:
        warnings.append({"code": "duplicate_names", "names": plan.duplicated,
                         "message": "These names occur more than once in the dataset; the first was used."})
    if names["constant"] and plan.recipe.method == "zscore_mean":
        warnings.append({"code": "constant_genes", "names": names["constant"],
                         "message": "These genes have the same value in every cell and were left out of the z-score mean."})
    if names["no_values"]:
        warnings.append({"code": "no_values", "names": names["no_values"],
                         "message": "These genes have no value in any cell and were left out."})
    return {"type": "result", "algorithm_version": gene_score.ALGORITHM_VERSION,
            "recipe": plan.recipe.describe(), "scored": shown is not None, "reason": result.reason,
            "message": gene_score.NO_SCORE_MESSAGES.get(result.reason), "n_cells": result.n_cells,
            "n_shown": result.n_shown, "n_used": result.n_used, "genes": [_gene_json(g) for g in result.genes],
            "missing": plan.missing, "duplicated": plan.duplicated, "warnings": warnings,
            **({"n_controls": len(result.controls or ()), "n_controls_used": result.n_controls_used,
                "binning": plan.binning} if plan.recipe.method == "control_adjusted" else {}),
            "entries_read": result.entries_read, "seconds": round(result.seconds, 3),
            "dtype": "float32", "byte_length": 0 if shown is None else int(shown.size) * 4}


def _error_frame(exc):
    """The ``error`` frame for a failure after the stream began."""
    if isinstance(exc, gene_score.ScoreError):
        return {"type": "error", "reason": exc.reason, "message": exc.message}
    exceeded = remote.find_deadline_exceeded(exc)
    if exceeded is not None:
        return {"type": "error", "reason": "remote_deadline", "message": str(exceeded)}
    if remote.is_timeout(exc):
        return {"type": "error", "reason": "remote_timeout", "message": f"Timed out reading the dataset: {exc}"}
    logger.exception("Gene score failed")
    return {"type": "error", "reason": "read_failed", "message": f"Failed to read the dataset: {exc}"}


def _stream(plan, shown_rows, release):
    """The response body. ``release`` is called once, when the response closes (also when it never started)."""
    def frames():
        events = None
        try:
            with remote.deadline(REMOTE_COMPUTE_S if plan.remote else None):
                events = gene_score.compute(plan, shown_rows)
                for kind, payload in events:
                    if kind == "progress":
                        done, total = payload
                        yield _frame({"type": "progress", "done": done, "total": total})
                    else:
                        yield _frame(_result_frame(plan, payload))
                        if payload.values is not None:
                            data = memoryview(payload.values.astype("<f4", copy=False)).cast("B")
                            for start in range(0, len(data), WRITE_CHUNK):
                                yield bytes(data[start:start + WRITE_CHUNK])
        except GeneratorExit:
            raise
        except Exception as exc:
            yield _frame(_error_frame(exc))
        finally:
            if events is not None:
                events.close()
            release()
    return frames()


def register_gene_score_routes(app_, api_version):
    @app_.route(f"/api/{api_version}/data/gene_score", methods=["POST"])
    @access.gate("dataset")
    def gene_score_route():
        dataset_path = request.args.get("dataset_path")
        if not dataset_path:
            return _error(400, "bad_request", "dataset_path parameter is required")
        try:
            reader = get_reader(dataset_path)    # a missing store answers before the body is looked at, as on every route
        except Exception as exc:
            return data_routes._reader_error_response(exc, dataset_path)
        body, refusal = _body()
        if refusal:
            return _error(*refusal)
        named = body.get("dataset_path")
        if named is not None and named not in (dataset_path, access.spelled(dataset_path)):
            return _error(400, "dataset_path_conflict",
                          "dataset_path in the body must name the dataset of the request's dataset_path.")
        try:
            recipe = gene_score.parse_recipe(body.get("recipe"))
            plan = gene_score.plan(reader, dataset_path, recipe)
        except gene_score.ScoreError as exc:
            return _error(exc.status, exc.reason, exc.message, **exc.extra)
        except Exception as exc:
            return data_routes._reader_error_response(exc, dataset_path)
        estimate = plan.estimate()

        if body.get("estimate_only", False):
            return jsonify({"estimate": estimate, "missing": plan.missing, "duplicated": plan.duplicated,
                            "recipe": recipe.describe()})
        if plan.tier == "refused":
            hint = (" The matrix is stored by cell (CSR), which is slow to read by gene; a copy stored by gene "
                    "(CSC) would be far faster." if plan.layout == "csr" else "")
            return _error(413, "score_too_expensive",
                          f"This score would take about {plan.seconds / 60:.0f} minutes; the limit is "
                          f"{gene_score.CONFIRM_MAX_S / 60:.0f}. Use fewer genes.{hint}", estimate=estimate)
        if plan.tier == "confirm" and not body.get("confirm", False):
            return _error(409, "confirmation_required",
                          f"This score would take about {plan.seconds:.0f} seconds. Send confirm: true to compute it.",
                          estimate=estimate)

        shown_rows = None
        if body.get("subset") is not None:
            raw = body["subset"]
            try:
                resolved = cell_subset.resolve(reader, dataset_path, raw if isinstance(raw, str) else json.dumps(raw),
                                               app_.config, client=None, low=False)
            except cell_subset.SubsetError as exc:
                return _error(exc.status, exc.reason, exc.message)
            except Exception as exc:
                return data_routes._reader_error_response(exc, dataset_path)
            shown_rows = None if resolved is None else resolved.indices

        # one computation at a time; the memory it holds is accounted with the other large reads
        if not _slot.acquire(timeout=QUEUE_WAIT_S):
            raise read_guard.ReadBusyError("Another gene score is being computed; try again in a moment.",
                                           max(1, int(QUEUE_WAIT_S)))
        released = []
        admitted = None

        def release():
            if released:
                return
            released.append(True)
            try:
                if admitted is not None:
                    admitted.__exit__(None, None, None)
            finally:
                _slot.release()
        try:
            n_shown = plan.n_obs if shown_rows is None else int(shown_rows.size)
            need = n_shown * (8 + 2) * plan.vectors + min(gene_score.READ_AHEAD_ENTRIES, plan.entries) * 12
            admitted = read_guard.admit(need)
            admitted.__enter__()
        except BaseException:
            admitted = None
            release()
            raise
        response = Response(_stream(plan, shown_rows, release), mimetype=MIMETYPE)
        response.call_on_close(release)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Accel-Buffering"] = "no"
        response.headers["X-Annzarro-Score-Version"] = str(gene_score.ALGORITHM_VERSION)
        return response


def register_matrix_kind_route(app_, api_version):
    """``GET /api/v1/data/matrix_kind?dataset_path=&input=X``: what the numbers of an input look like.

    ``{"input", "kind", "stats", "suggest", "checked"}``. ``kind`` is one of ``counts``, ``normalised``,
    ``log``, ``signed``, ``other`` or ``unknown`` (core/matrix_kind.py); ``suggest`` names a layer that looks
    log-normalised when the input does not (only then are the other matrices looked at). A sample of a few
    thousand stored values is read, never the matrix.
    """
    @app_.route(f"/api/{api_version}/data/matrix_kind", methods=["GET"])
    @access.gate("dataset")
    def matrix_kind_route():
        dataset_path = request.args.get("dataset_path")
        if not dataset_path:
            return _error(400, "bad_request", "dataset_path parameter is required")
        name = request.args.get("input", "X")
        if not name or len(name) > gene_score.MAX_NAME_CHARS:
            return _error(400, "bad_request", "input must be 'X' or the name of a layer.")
        try:
            reader = get_reader(dataset_path)
            with remote.deadline(REMOTE_KIND_S if remote.is_remote_path(dataset_path) else None):
                return jsonify(gene_score.matrix_kinds(reader, dataset_path, name))
        except gene_score.ScoreError as exc:
            return _error(exc.status, exc.reason, exc.message, **exc.extra)
        except Exception as exc:
            return data_routes._reader_error_response(exc, dataset_path)
