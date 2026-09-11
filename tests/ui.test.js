const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeElement {
  constructor({ id = '', tagName = 'div', textContent = '', dataset = {} } = {}) {
    this.id = id;
    this.tagName = tagName;
    this.textContent = textContent;
    this.dataset = { ...dataset };
    this.children = [];
    this.listeners = {};
    this.value = '';
    this.hidden = false;
    this.classList = {
      add: () => {},
      remove: () => {},
    };
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(name, handler) {
    this.listeners[name] = handler;
  }

  dispatch(name) {
    const handler = this.listeners[name];
    if (handler) handler({ target: this });
  }

  querySelector(selector) {
    if (selector === '.title') {
      return { textContent: this.textContent };
    }
    return null;
  }

  set innerHTML(value) {
    if (value === '') this.children = [];
  }
}

function makeProduct(title, price, brand) {
  const item = new FakeElement({ textContent: title, dataset: { price: String(price), brand } });
  item.querySelector = (selector) => (selector === '.title' ? { textContent: title } : null);
  return item;
}

function setup() {
  const list = new FakeElement({ id: 'list', tagName: 'ol' });
  list.children = [
    makeProduct('General Mobile Gm 26 5G 8+128 GB Akıllı Telefon Siyah', 12699, 'Diğer'),
    makeProduct('General Mobile Gm 26 Pro 5G 12+256 GB Akıllı Telefon', 25999, 'Diğer'),
    makeProduct('Redmi Pad 6GB Ram, 128GB Depolama (Xiaomi)', 13999, 'xiaomi'),
  ];

  const elements = {
    'scroll-to-top': new FakeElement({ id: 'scroll-to-top', tagName: 'button' }),
    'sort-select': new FakeElement({ id: 'sort-select', tagName: 'select' }),
    'brand-filter': new FakeElement({ id: 'brand-filter', tagName: 'select' }),
    'search-input': new FakeElement({ id: 'search-input', tagName: 'input' }),
    'clear-filters': new FakeElement({ id: 'clear-filters', tagName: 'button' }),
    'result-summary': new FakeElement({ id: 'result-summary', tagName: 'p' }),
    'empty-state': new FakeElement({ id: 'empty-state', tagName: 'p' }),
  };
  elements['sort-select'].value = 'default';
  elements['brand-filter'].value = 'all';
  elements['empty-state'].hidden = true;

  const document = {
    getElementById: (id) => elements[id],
    querySelector: (selector) => (selector === '.list-group-numbered' ? list : null),
    createElement: (tagName) => new FakeElement({ tagName }),
    listeners: {},
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    },
    fire(name) {
      if (this.listeners[name]) this.listeners[name]();
    },
  };
  const window = {
    scrollY: 0,
    addEventListener: () => {},
    scrollTo: () => {},
  };

  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const scriptMatches = [...html.matchAll(/<script>\s*([\s\S]*?)<\/script>/g)];
  const script = scriptMatches[scriptMatches.length - 1][1];
  const context = { document, window, console };
  vm.runInNewContext(script, context, { filename: 'index.html' });
  document.fire('DOMContentLoaded');

  return { elements, list };
}

function titles(list) {
  return list.children.map((item) => item.textContent);
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
}

test('baseline ürün listesi korunur ve mevcut fiyat sıralaması çalışır', () => {
  const { elements, list } = setup();
  assert.strictEqual(list.children.length, 3);
  elements['sort-select'].value = 'price-asc';
  elements['sort-select'].dispatch('change');
  assert.deepStrictEqual(list.children.map((item) => Number(item.dataset.price)), [12699, 13999, 25999]);
});

test('marka filtresi büyük-küçük harf farkından etkilenmez', () => {
  const { elements, list } = setup();
  elements['brand-filter'].value = 'Diğer';
  elements['brand-filter'].dispatch('change');
  assert.strictEqual(list.children.length, 2);
});

test('ürün araması başlık ve marka üzerinden sonuçları daraltır', () => {
  const { elements, list } = setup();
  elements['search-input'].value = 'xiaomi';
  elements['search-input'].dispatch('input');
  assert.strictEqual(list.children.length, 1);
  assert.match(titles(list)[0], /Xiaomi/i);
});

test('sonuç özeti başlangıçta ve filtre sonrasında güncellenir', () => {
  const { elements } = setup();
  assert.match(elements['result-summary'].textContent, /3/);
  elements['search-input'].value = 'bulunamayacak ürün';
  elements['search-input'].dispatch('input');
  assert.match(elements['result-summary'].textContent, /0/);
  assert.strictEqual(elements['empty-state'].hidden, false);
});

test('filtreleri temizle listeyi varsayılan duruma döndürür', () => {
  const { elements, list } = setup();
  elements['search-input'].value = 'General';
  elements['search-input'].dispatch('input');
  elements['brand-filter'].value = 'Diğer';
  elements['brand-filter'].dispatch('change');
  elements['sort-select'].value = 'price-desc';
  elements['sort-select'].dispatch('change');
  elements['clear-filters'].dispatch('click');
  assert.strictEqual(elements['search-input'].value, '');
  assert.strictEqual(elements['brand-filter'].value, 'all');
  assert.strictEqual(elements['sort-select'].value, 'default');
  assert.strictEqual(list.children.length, 3);
});

test('alfabetik sıralama seçeneği HTML içinde görünür', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<option\s+value=["']alpha-asc["']/);
});

if (process.exitCode) process.exit(1);
