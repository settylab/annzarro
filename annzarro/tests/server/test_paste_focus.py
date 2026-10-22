"""Paste to focus: the policy keys ui.paste_focus.enabled / .rules (annzarro/server/paste_focus.py).

The type refuses what a JavaScript regular expression cannot be, a rule without a cell or gene group,
more than 20 rules and patterns over 500 characters. The admin saves through PUT /api/v1/admin/policy
(admin only, CSRF), and the browser reads the value from /api/v1/policy/effective.
"""
import json

import pytest

from annzarro.server.paste_focus import (DEFAULT_PATTERN, DEFAULT_RULE, ENABLED_KEY, MAX_PATTERN, MAX_RULES, RULES_KEY,
                                         PasteRules, check_pattern)
from annzarro.server.policy.types import PolicyValueError
from annzarro.tests.server.admin_helpers import ADMIN, USER, login, make_app, unsafe_headers

POLICY = "/api/v1/admin/policy"
EFFECTIVE = "/api/v1/policy/effective"
ROW_PATTERN = r"^(?<dataset>[^\t]+)\t[^\t]*\t[^\t]*\t(?<cell>[^\t]+)"


def put(client, body, **headers):
    return client.put(POLICY, data=json.dumps(body), headers=headers or unsafe_headers(client))


@pytest.fixture
def app(tmp_path):
    return make_app(tmp_path)


@pytest.fixture
def admin(app):
    return login(app, ADMIN)


@pytest.mark.parametrize("pattern", [
    DEFAULT_PATTERN,
    ROW_PATTERN,
    r"^(?<gene>[A-Z0-9-]+)$",
    r"(?<=id:)(?<cell>\w+)",
    r"^(?<cell>[^\s]+?)\s*(?<gene>\S*)$",
    r"^(?<dataset>\w+)/(?<cell>\w+)(?:\s.*)?$",
    r"(?<cell>a{2,3})\k<cell>",
])
def test_javascript_patterns_with_a_cell_or_gene_group_are_accepted(pattern):
    assert check_pattern(pattern) == pattern


@pytest.mark.parametrize("pattern, why", [
    ("", "needs a pattern"),
    (None, "needs a pattern"),
    ("(?P<cell>a)", "JavaScript"),               # Python's named group
    ("(?i)(?<cell>a)", "JavaScript"),            # inline flags
    ("(?>a)(?<cell>b)", "JavaScript"),           # atomic group
    ("(?#c)(?<cell>b)", "JavaScript"),
    ("(?<cell>a)*+", "possessive"),
    ("(?<cell>a++)", "possessive"),
    (r"\A(?<cell>a)", "not supported"),
    (r"(?<cell>a)\Z", "not supported"),
    (r"(?<cell>\p{L})", "not supported"),
    ("(?<cell>a", "valid regular expression"),
    ("(?<cell>a))", "valid regular expression"),
    ("(?<cell>a)[", "unterminated"),
    ("(?<cell>*)", "valid regular expression"),
    ("(?<=a+)(?<cell>b)", "valid regular expression"),     # a lookbehind of unbounded length
    ("^(a)(b)$", "cell"),                                    # no named group
    ("(?<other>a)", "cell"),
    ("x" * (MAX_PATTERN + 1), "at most"),
    (7, "needs a pattern"),
])
def test_other_patterns_are_refused_with_a_reason(pattern, why):
    with pytest.raises(PolicyValueError) as caught:
        check_pattern(pattern)
    assert why in str(caught.value)


def test_a_rule_is_canonical_and_defaults_fill_in():
    rules = PasteRules().validate([{"pattern": ROW_PATTERN}, {"pattern": "(?<gene>x)", "dataset_match": "exact", "enabled": False}])
    assert rules == [{"pattern": ROW_PATTERN, "dataset_match": "prefix", "enabled": True},
                     {"pattern": "(?<gene>x)", "dataset_match": "exact", "enabled": False}]


@pytest.mark.parametrize("value", [
    "not a list", {"pattern": "(?<cell>a)"}, [3], [{"pattern": "(?<cell>a)", "extra": 1}],
    [{"pattern": "(?<cell>a)", "dataset_match": "suffix"}], [{"pattern": "(?<cell>a)", "enabled": "yes"}],
    [{"dataset_match": "exact"}],
])
def test_malformed_rules_are_refused(value):
    with pytest.raises(PolicyValueError):
        PasteRules().validate(value)


def test_the_number_of_rules_is_capped():
    one = {"pattern": "(?<cell>a)"}
    assert len(PasteRules().validate([one] * MAX_RULES)) == MAX_RULES
    with pytest.raises(PolicyValueError, match="at most 20"):
        PasteRules().validate([one] * (MAX_RULES + 1))


def test_the_error_names_the_rule():
    with pytest.raises(PolicyValueError, match="rule 2: "):
        PasteRules().validate([{"pattern": "(?<cell>a)"}, {"pattern": "(?<cell>"}])


def test_an_empty_list_is_allowed_it_turns_every_rule_off():
    assert PasteRules().validate([]) == []


def test_defaults_are_on_with_the_single_token_rule(admin):
    keys = {k["name"]: k for k in admin.get(POLICY).get_json()["keys"]}
    assert keys[ENABLED_KEY]["value"] is True and keys[ENABLED_KEY]["source"] == "default"
    assert keys[RULES_KEY]["value"] == [DEFAULT_RULE]
    assert keys[RULES_KEY]["type"]["kind"] == "paste_rules"
    assert keys[RULES_KEY]["type"]["max_rules"] == MAX_RULES
    assert keys[RULES_KEY]["area"] == "features" and not keys[RULES_KEY]["section"]
    assert len(keys[RULES_KEY]["description"]) > 40


def test_an_admin_saves_the_rules_and_the_browser_reads_them(app, admin):
    rule = {"pattern": ROW_PATTERN, "dataset_match": "prefix", "enabled": True}
    response = put(admin, {RULES_KEY: [rule]})
    assert response.status_code == 200, response.get_data(as_text=True)
    user = login(app, USER)
    values = user.get(f"{EFFECTIVE}?keys={RULES_KEY},{ENABLED_KEY}").get_json()["values"]
    assert values[RULES_KEY] == [rule]
    assert values[ENABLED_KEY] is True
    assert put(admin, {ENABLED_KEY: False}).status_code == 200
    assert user.get(f"{EFFECTIVE}?keys={ENABLED_KEY}").get_json()["values"][ENABLED_KEY] is False
    reset = put(admin, {RULES_KEY: None})
    assert reset.status_code == 200
    assert user.get(f"{EFFECTIVE}?keys={RULES_KEY}").get_json()["values"][RULES_KEY] == [DEFAULT_RULE]


@pytest.mark.parametrize("rules", [
    [{"pattern": "(?P<cell>a)"}],
    [{"pattern": "(?<cell>a"}],
    [{"pattern": "(?<x>a)"}],
    [{"pattern": "(?<cell>a)"}] * 21,
    [{"pattern": "(?<cell>" + "a" * 500 + ")"}],
])
def test_the_save_endpoint_refuses_a_bad_rule_and_stores_nothing(admin, rules):
    response = put(admin, {RULES_KEY: rules})
    assert response.status_code == 400, response.get_data(as_text=True)
    keys = {k["name"]: k for k in admin.get(POLICY).get_json()["keys"]}
    assert keys[RULES_KEY]["value"] == [DEFAULT_RULE] and keys[RULES_KEY]["source"] == "default"


def test_only_an_admin_with_a_csrf_token_can_save(app, admin):
    body = {RULES_KEY: [{"pattern": "(?<cell>a)"}]}
    user = login(app, USER)
    assert put(user, body).status_code == 403
    assert put(admin, body, **{"Content-Type": "application/json"}).status_code == 403     # no CSRF header
    assert put(admin, body, **{"X-AnnZarro-CSRF": "wrong", "Content-Type": "application/json"}).status_code == 403
    assert app.test_client().put(POLICY, data=json.dumps(body)).status_code in (401, 403)
    keys = {k["name"]: k for k in admin.get(POLICY).get_json()["keys"]}
    assert keys[RULES_KEY]["value"] == [DEFAULT_RULE]


def test_the_config_file_sets_the_rules(tmp_path):
    rules = [{"pattern": ROW_PATTERN, "dataset_match": "contains"}]
    app = make_app(tmp_path, ui={"paste_focus": {"enabled": False, "rules": rules}})
    admin = login(app, ADMIN)
    keys = {k["name"]: k for k in admin.get(POLICY).get_json()["keys"]}
    assert keys[ENABLED_KEY]["value"] is False
    assert keys[RULES_KEY]["value"] == [{"pattern": ROW_PATTERN, "dataset_match": "contains", "enabled": True}]
