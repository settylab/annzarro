// A minimal DOM for the admin interface's unit tests: just enough of
// Element / Text / Document for static/js/admin/dom.js and the renderers
// built on it. Not a general DOM; there is no layout, parsing or selector engine
// beyond `tag`, `.class`, `#id` and `[attr]` / `[attr="v"]`, one compound at a time.

class FakeText {
  constructor(text) {
    this.nodeType = 3;
    this.data = text;
    this.parentNode = null;
  }
  get textContent() { return this.data; }
}

class FakeElement {
  constructor(tag, doc) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.attributes = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = "";
    const self = this;
    this.classList = {
      contains: (c) => self.classes().includes(c),
      add: (c) => self.setAttribute("class", [...new Set([...self.classes(), c])].join(" ")),
      remove: (c) => self.setAttribute("class", self.classes().filter((x) => x !== c).join(" ")),
    };
  }
  classes() { return (this.attributes.get("class") || "").split(/\s+/).filter(Boolean); }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  removeAttribute(k) { this.attributes.delete(k); }
  hasAttribute(k) { return this.attributes.has(k); }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get id() { return this.getAttribute("id") || ""; }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) this.childNodes.splice(i, 1);
    node.parentNode = null;
    return node;
  }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
  set textContent(text) {
    for (const n of this.childNodes) n.parentNode = null;
    this.childNodes = [];
    if (text !== "") this.appendChild(new FakeText(String(text)));
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  // Fire `type`; `props` become fields of the event (target defaults to this).
  async dispatch(type, props = {}) {
    const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...props };
    for (const fn of this.listeners.get(type) || []) await fn(event);
    return event;
  }
  focus() {}
  select() {}
  matches(selector) {
    const m = selector.match(/^([A-Za-z0-9]*)((?:[.#][\w-]+|\[[^\]]+\])*)$/);
    if (!m) throw new Error(`fake-dom: unsupported selector ${selector}`);
    if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
    for (const part of m[2].match(/[.#][\w-]+|\[[^\]]+\]/g) || []) {
      if (part[0] === ".") { if (!this.classes().includes(part.slice(1))) return false; }
      else if (part[0] === "#") { if (this.id !== part.slice(1)) return false; }
      else {
        const [, name, want] = part.match(/^\[([\w:-]+)(?:="?([^"\]]*)"?)?\]$/);
        if (want === undefined ? !this.hasAttribute(name) : this.getAttribute(name) !== want) return false;
      }
    }
    return true;
  }
  querySelectorAll(selector) {
    const out = [];
    const walk = (node) => {
      for (const c of node.children) {
        if (c.matches(selector)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

export function installFakeDocument() {
  const doc = {
    createElement: (tag) => new FakeElement(tag, doc),
    createTextNode: (text) => new FakeText(text),
    querySelector: (s) => doc.documentElement.querySelector(s),
    getElementById: (id) => doc.documentElement.querySelector(`#${id}`),
    hidden: false,
  };
  doc.documentElement = new FakeElement("html", doc);
  doc.body = doc.createElement("body");
  doc.head = doc.createElement("head");
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  globalThis.document = doc;
  return doc;
}

export function uninstallFakeDocument() {
  delete globalThis.document;
}

// First descendant (or the root) satisfying `pred`, depth first.
export function find(root, pred) {
  if (root.nodeType === 1 && pred(root)) return root;
  for (const c of root.children || []) {
    const hit = find(c, pred);
    if (hit) return hit;
  }
  return null;
}

export function findAll(root, pred, out = []) {
  if (root.nodeType === 1 && pred(root)) out.push(root);
  for (const c of root.children || []) findAll(c, pred, out);
  return out;
}

// A Response stand-in: status, JSON body, optional headers.
export function reply(status, body, headers = {}) {
  const text = body === undefined ? "" : JSON.stringify(body);
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => lower[k.toLowerCase()] ?? null },
    text: async () => text,
  };
}
