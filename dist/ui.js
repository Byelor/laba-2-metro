"use strict";
(() => {
    if (typeof document === 'undefined')
        return;
    const el = (id) => document.getElementById(id);
    const code = el('code');
    function update() {
        const r = analyze(code.value);
        el('CL').textContent = String(r.CL);
        el('ops').textContent = String(r.ops);
        el('cl').textContent = r.cl.toFixed(2);
        el('CLI').textContent = String(r.CLI);
        el('McCabe').textContent = String(r.McCabe);
        el('found').innerHTML = r.found
            .map(b => `<tr><td>${b.line}</td><td>${b.kind}</td><td>${b.level}</td></tr>`)
            .join('');
    }
    code.addEventListener('input', update);
    el('file').addEventListener('change', async (e) => {
        const f = e.target.files?.[0];
        if (f) {
            code.value = await f.text();
            update();
        }
    });
    update();
})();
