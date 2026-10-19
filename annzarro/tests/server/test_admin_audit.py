"""The audit log: a hash chain that shows tampering, rotation, concurrent writers, the server-log mirror."""
import json
import logging
import multiprocessing
import os

import pytest

from annzarro.server.admin import audit


def _append(directory, n=1, **kw):
    out = None
    for i in range(n):
        out = audit.append(directory, actor="alice", addr="10.0.0.5", via="web", action="user.add",
                           target=f"u{i}", detail={"i": i}, **kw)
    return out


def _lines(directory, name="audit.jsonl"):
    with open(os.path.join(directory, name), "rb") as f:
        return f.read().splitlines(keepends=True)


def _write_lines(directory, lines, name="audit.jsonl"):
    with open(os.path.join(directory, name), "wb") as f:
        f.write(b"".join(lines))


def _append_worker(directory, n, start):
    start.wait()
    for _ in range(n):
        audit.append(directory, actor="p", addr=None, via="web", action="cache.clear")


def test_chain_verifies_and_records_are_sequential(tmp_path):
    d = str(tmp_path)
    assert audit.verify(d)["ok"], "an empty log is fine"
    _append(d, 5)
    assert audit.verify(d)["ok"]
    records = audit.read(d)
    assert [r["seq"] for r in records] == [5, 4, 3, 2, 1], "newest first"
    assert records[-1]["prev"] == audit.GENESIS
    assert all(records[i]["prev"] == records[i + 1]["hash"] for i in range(4))
    assert oct(os.stat(os.path.join(d, "audit.jsonl")).st_mode & 0o777) == "0o600"


@pytest.mark.parametrize("mutation", ["edit", "edit_rehashed", "delete", "insert", "reorder", "garbage"])
def test_tampering_in_the_middle_is_found(tmp_path, mutation):
    d = str(tmp_path)
    _append(d, 6)
    lines = _lines(d)
    rec = json.loads(lines[2])                             # seq 3
    if mutation == "edit":
        rec["actor"] = "mallory"
        lines[2] = (audit._canonical(rec) + "\n").encode()
        expected = 3
    elif mutation == "edit_rehashed":                      # the forger fixes this record's own hash
        rec["actor"] = "mallory"
        rec["hash"] = audit._hash(rec["prev"], rec)
        lines[2] = (audit._canonical(rec) + "\n").encode()
        expected = 4                                       # but the next record points at the old one
    elif mutation == "delete":
        del lines[2]
        expected = 4
    elif mutation == "insert":
        lines.insert(3, lines[2])
        expected = 3
    elif mutation == "reorder":
        lines[2], lines[3] = lines[3], lines[2]
        expected = 4
    else:
        lines[2] = b"this is not json\n"
        expected = 3
    _write_lines(d, lines)
    out = audit.verify(d)
    assert (out["ok"], out["first_bad_seq"], out["problem"]) == (False, expected, "tampered"), mutation


def test_cut_off_tail_is_found_by_the_head_and_always_in_the_server_log(tmp_path, caplog):
    d = str(tmp_path)
    with caplog.at_level(logging.INFO, logger="annzarro.audit"):
        _append(d, 4)
    mirrored = [json.loads(r.getMessage()) for r in caplog.records if r.name == "annzarro.audit"]
    assert [m["seq"] for m in mirrored] == [1, 2, 3, 4], "every record is also in the server log"
    assert mirrored[-1]["hash"] == audit.read(d)[0]["hash"]
    _write_lines(d, _lines(d)[:2])
    assert audit.verify(d)["problem"] == "truncated"
    os.unlink(os.path.join(d, audit.HEAD_NAME))        # an account that also removes the head is not stopped
    assert audit.verify(d)["ok"], "the file alone cannot show a missing tail"


def test_a_torn_last_line_is_not_tampering(tmp_path):
    d = str(tmp_path)
    _append(d, 2)
    with open(os.path.join(d, "audit.jsonl"), "ab") as f:
        f.write(b'{"seq":3,"ts":')                         # a crash in the middle of a write
    out = audit.verify(d)
    assert out["ok"] and out["torn"] == [3]
    record = _append(d)                                    # the log goes on from the last good record
    assert record["seq"] == 3 and record["prev"] == audit.read(d)[1]["hash"]
    out = audit.verify(d)
    assert out["ok"] and out["torn"] == [3] and out["records"] == 3 and out["last_seq"] == 3


def test_garbage_that_replaced_a_record_is_tampering_not_torn(tmp_path):
    d = str(tmp_path)
    _append(d, 5)
    lines = _lines(d)
    lines[2] = b'{"seq":3,"ts":\n'                         # looks torn, but record 4 points at record 3
    _write_lines(d, lines)
    out = audit.verify(d)
    assert (out["ok"], out["first_bad_seq"], out["torn"]) == (False, 3, [])


def test_a_deleted_or_truncated_log_is_reported(tmp_path):
    d = str(tmp_path)
    _append(d, 5)
    lines = _lines(d)
    _write_lines(d, lines[:3])
    out = audit.verify(d)
    assert (out["ok"], out["problem"], out["first_bad_seq"]) == (False, "truncated", 4)
    _write_lines(d, lines)
    assert audit.verify(d)["ok"]
    os.unlink(os.path.join(d, "audit.jsonl"))
    out = audit.verify(d)
    assert (out["ok"], out["problem"]) == (False, "truncated")


def test_a_tail_rewritten_to_the_same_length_is_reported(tmp_path):
    d = str(tmp_path)
    _append(d, 3)
    lines = _lines(d)
    rec = json.loads(lines[2])
    rec["actor"] = "mallory"
    rec["hash"] = audit._hash(rec["prev"], rec)            # a forger who fixes the record's own hash
    lines[2] = (audit._canonical(rec) + "\n").encode()
    _write_lines(d, lines)
    out = audit.verify(d)
    assert (out["ok"], out["problem"]) == (False, "tampered"), "the head still holds the real hash"


def test_the_summary_says_where_the_history_starts(tmp_path):
    d = str(tmp_path)
    for _ in range(60):
        _append(d, max_mb=0.0005)
    os.unlink(os.path.join(d, "audit.jsonl.5"))            # older history dropped: the anchor moves
    os.unlink(os.path.join(d, "audit.jsonl.4"))
    out = audit.verify(d)
    assert out["ok"] and out["first_seq"] > 1 and out["last_seq"] == 60
    assert out["records"] == out["last_seq"] - out["first_seq"] + 1


def test_verify_retries_over_a_rotation_in_progress(tmp_path, monkeypatch):
    d = str(tmp_path)
    for _ in range(8):
        _append(d, max_mb=0.0005)
    calls = []
    real = audit._verify_once

    def racing(directory):
        calls.append(1)
        out = real(directory)
        if len(calls) == 1:                                # a writer rotates while we read
            _append(directory, max_mb=0.0005)
            out = dict(out, ok=False, first_bad_seq=3, problem="tampered")
        return out

    monkeypatch.setattr(audit, "_verify_once", racing)
    assert audit.verify(d)["ok"] and len(calls) == 2


def test_never_stores_what_it_is_not_given_and_truncates_a_huge_detail(tmp_path):
    d = str(tmp_path)
    rec = audit.append(d, actor="a", addr=None, via="cli:root", action="policy.set", detail={"k": "x" * 5000})
    assert rec["detail"] == {"truncated": True} and rec["via"] == "cli:root"
    assert audit.verify(d)["ok"]


def test_read_pages_backwards(tmp_path):
    d = str(tmp_path)
    _append(d, 30)
    page = audit.read(d, limit=10)
    assert [r["seq"] for r in page] == list(range(30, 20, -1))
    older = audit.read(d, before_seq=page[-1]["seq"], limit=10)
    assert [r["seq"] for r in older] == list(range(20, 10, -1))
    assert audit.read(d, before_seq=1) == []


def test_rotation_continues_the_chain(tmp_path):
    d = str(tmp_path)
    for _ in range(39):                                    # ~0.0005 MB threshold: rotates often
        _append(d, max_mb=0.0005)
    _append(d)                                             # the last rotation may have left no current file
    files = sorted(f for f in os.listdir(d) if f.startswith("audit.jsonl"))
    assert "audit.jsonl.1" in files
    assert audit.verify(d)["ok"]
    seqs = [r["seq"] for r in audit.read(d, limit=500)]
    assert seqs == sorted(seqs, reverse=True) and seqs[0] == 40
    assert seqs == list(range(40, 40 - len(seqs), -1)), "no gaps across the rotations"
    first_of_new = json.loads(_lines(d)[0])
    last_of_old = json.loads(_lines(d, "audit.jsonl.1")[-1])
    assert first_of_new["prev"] == last_of_old["hash"] and first_of_new["seq"] == last_of_old["seq"] + 1


def test_a_missing_rotation_breaks_the_chain(tmp_path):
    d = str(tmp_path)
    for _ in range(60):
        _append(d, max_mb=0.0005)
    os.unlink(os.path.join(d, "audit.jsonl.2"))
    assert audit.verify(d)["ok"] is False


def test_only_five_rotations_are_kept(tmp_path):
    d = str(tmp_path)
    for _ in range(300):
        _append(d, max_mb=0.0005)
    assert not os.path.exists(os.path.join(d, "audit.jsonl.6"))
    assert audit.verify(d)["ok"], "the oldest kept file is the anchor"


def test_concurrent_processes_get_unique_gapless_seq(tmp_path):
    ctx = multiprocessing.get_context("spawn")
    d, start = str(tmp_path), ctx.Event()
    procs = [ctx.Process(target=_append_worker, args=(d, 25, start)) for _ in range(4)]
    for p in procs:
        p.start()
    start.set()
    for p in procs:
        p.join(60)
        assert p.exitcode == 0
    assert [r["seq"] for r in reversed(audit.read(d, limit=500))] == list(range(1, 101))
    assert audit.verify(d)["ok"]


def test_verify_cached_follows_changes(tmp_path):
    d = str(tmp_path)
    _append(d, 3)
    assert audit.verify_cached(d)["ok"]
    lines = _lines(d)
    lines[1] = lines[1].replace(b"alice", b"mallo")
    _write_lines(d, lines)
    assert audit.verify_cached(d)["first_bad_seq"] == 2


def test_a_request_id_is_part_of_the_chain_and_old_records_still_verify(tmp_path):
    d = str(tmp_path)
    _append(d, 2)                                       # a log written before request ids
    rec = _append(d, request_id="3f1c9a0b5d2e4a67")
    _append(d, request_id=None)
    assert audit.verify(d)["ok"]
    assert rec["request_id"] == "3f1c9a0b5d2e4a67"
    assert ["request_id" in r for r in audit.read(d)] == [False, True, False, False]
    lines = _lines(d)
    lines[2] = lines[2].replace(b"3f1c9a0b5d2e4a67", b"0000000000000000")
    _write_lines(d, lines)
    assert audit.verify(d)["first_bad_seq"] == 3, "the id is covered by the hash"
