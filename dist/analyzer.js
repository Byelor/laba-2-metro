"use strict";
/*
 * Метрики Джилба (и Маккейба) для программ на Go.
 *
 * Правила:
 *  - CL: каждый if (в т.ч. каждый else if), каждый for (любая форма: классический,
 *    «while»-стиль, бесконечный, range) и каждая ветка case в switch/select.
 *  - switch из k веток case == k вложенных if. Селектор и default не считаются.
 *  - CLI: максимальный уровень вложенности, отсчёт с 0 (одиночный if -> 0).
 *  - Оператор (для cl = CL / число операторов): простая инструкция + каждое
 *    ветвление. break, fallthrough, package, import, type и заголовки func не считаются.
 */
const KEYWORDS = new Set(['break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else',
    'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package',
    'range', 'return', 'select', 'struct', 'switch', 'type', 'var']);
const STMT_END_KW = new Set(['break', 'continue', 'fallthrough', 'return']);
const IDENT = /[\p{L}_][\p{L}\p{N}_]*/uy;
const NUM = /\.?\d[\w.]*/y;
const OPS = /<<=|>>=|&\^=|\.\.\.|&&|\|\||<-|\+\+|--|==|!=|<=|>=|:=|[-+*\/%&|^]=|<<|>>|&\^|\S/uy;
// Правило Go: в конце строки автоматически вставляется ';'
function endsStmt(t) {
    if (/^[\p{L}_]/u.test(t))
        return !KEYWORDS.has(t) || STMT_END_KW.has(t);
    if (/^\.?\d/.test(t))
        return true;
    return t === '++' || t === '--' || t === ')' || t === ']' || t === '}';
}
function sticky(re, s, i) {
    re.lastIndex = i;
    const m = re.exec(s);
    return m ? m[0] : null;
}
function tokenize(src) {
    const toks = [];
    let i = 0, line = 1;
    const nl = () => {
        const last = toks[toks.length - 1];
        if (last && endsStmt(last.t))
            toks.push({ t: ';', line });
    };
    while (i < src.length) {
        const c = src[i];
        if (c === '\n') {
            nl();
            line++;
            i++;
            continue;
        }
        if (c === ' ' || c === '\t' || c === '\r') {
            i++;
            continue;
        }
        if (src.startsWith('//', i)) {
            while (i < src.length && src[i] !== '\n')
                i++;
            continue;
        }
        if (src.startsWith('/*', i)) {
            let end = src.indexOf('*/', i + 2);
            if (end < 0)
                end = src.length;
            const body = src.slice(i, end);
            if (body.includes('\n')) {
                nl();
                line += body.split('\n').length - 1;
            }
            i = end + 2;
            continue;
        }
        if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < src.length && src[j] !== c && src[j] !== '\n')
                j += src[j] === '\\' ? 2 : 1;
            toks.push({ t: c === '"' ? 'STR' : 'CHR', line });
            i = j + 1;
            continue;
        }
        if (c === '`') {
            let end = src.indexOf('`', i + 1);
            if (end < 0)
                end = src.length;
            toks.push({ t: 'STR', line });
            line += src.slice(i, end).split('\n').length - 1;
            i = end + 1;
            continue;
        }
        const w = sticky(IDENT, src, i) ?? sticky(NUM, src, i) ?? sticky(OPS, src, i);
        if (w === null) {
            i++;
            continue;
        }
        toks.push({ t: w, line });
        i += w.length;
    }
    nl();
    return toks;
}
class Analyzer {
    constructor(src) {
        this.p = 0;
        this.cl = 0;
        this.ops = 0;
        this.maxLevel = 0;
        this.found = [];
        this.t = tokenize(src);
    }
    peek(k = 0) { return this.t[this.p + k]?.t; }
    ln() { return this.t[this.p]?.line ?? 0; }
    condition(line, kind, level) {
        this.cl++;
        this.ops++;
        this.maxLevel = Math.max(this.maxLevel, level);
        this.found.push({ line, kind, level });
    }
    // индекс закрывающей '}' для '{' на позиции open
    matching(open) {
        let d = 0;
        for (let j = open; j < this.t.length; j++) {
            if (this.t[j].t === '{')
                d++;
            else if (this.t[j].t === '}' && --d === 0)
                return j;
        }
        return this.t.length;
    }
    // индекс '{' (или '}' / ';' при stopSemi) на нулевой глубине скобок, начиная с p
    headerEnd(stopSemi) {
        let j = this.p, pd = 0;
        for (; j < this.t.length; j++) {
            const tk = this.t[j].t;
            if (tk === '(' || tk === '[')
                pd++;
            else if (tk === ')' || tk === ']')
                pd--;
            else if (pd === 0) {
                if ((tk === 'struct' || tk === 'interface') && this.t[j + 1]?.t === '{') {
                    j = this.matching(j + 1);
                    continue;
                }
                if (tk === '{' || tk === '}' || (stopSemi && tk === ';'))
                    break;
            }
        }
        return j;
    }
    block(depth) {
        this.p++; // '{'
        while (this.p < this.t.length && this.peek() !== '}') {
            const before = this.p;
            this.statement(depth);
            if (this.p === before)
                this.p++;
        }
        this.p++; // '}'
    }
    statement(depth) {
        const t = this.peek();
        if (t === undefined)
            return;
        const line = this.ln();
        const lvl = depth + 1;
        switch (t) {
            case ';':
                this.p++;
                return;
            case '{':
                this.block(depth);
                return;
            case 'if':
                this.p = this.headerEnd(false);
                this.condition(line, 'if', lvl);
                if (this.peek() === '{')
                    this.block(lvl);
                if (this.peek() === 'else') {
                    this.p++;
                    this.statement(lvl);
                }
                return;
            case 'for':
                this.p = this.headerEnd(false);
                this.condition(line, 'for', lvl);
                if (this.peek() === '{')
                    this.block(lvl);
                return;
            case 'switch':
            case 'select':
                this.p = this.headerEnd(false);
                if (this.peek() === '{')
                    this.switchBlock(depth);
                return;
            case 'func':
                this.p = this.headerEnd(true);
                if (this.peek() === '{')
                    this.block(depth);
                return;
            case 'package':
            case 'import':
            case 'type':
            case 'break':
            case 'fallthrough':
                this.simple(depth, false);
                return;
            case 'else':
                this.p++;
                return;
            default:
                if (this.peek(1) === ':' && /^[\p{L}_]/u.test(t) && !KEYWORDS.has(t)) {
                    this.p += 2;
                    return;
                } // метка
                this.simple(depth, true);
        }
    }
    // одна простая инструкция; тела func-литералов внутри разбираются как обычный код
    simple(depth, count) {
        const start = this.p;
        let bd = 0;
        while (this.p < this.t.length) {
            const tk = this.t[this.p].t;
            if (tk === 'func') {
                this.p = this.headerEnd(true);
                if (this.peek() === '{')
                    this.block(depth);
                continue;
            }
            if (tk === '(' || tk === '[' || tk === '{')
                bd++;
            else if (tk === ')' || tk === ']')
                bd = Math.max(0, bd - 1);
            else if (tk === '}') {
                if (bd === 0)
                    break;
                bd--;
            }
            else if (tk === ';' && bd === 0) {
                this.p++;
                break;
            }
            this.p++;
        }
        if (count && this.p > start)
            this.ops++;
    }
    skipLabel() {
        let pd = 0;
        while (this.p < this.t.length) {
            const tk = this.peek();
            this.p++;
            if (tk === '(' || tk === '[' || tk === '{')
                pd++;
            else if (tk === ')' || tk === ']' || tk === '}')
                pd--;
            else if (tk === ':' && pd === 0)
                return;
        }
    }
    switchBlock(depth) {
        const close = this.matching(this.p);
        let total = 0, bd = 0;
        for (let j = this.p; j < close; j++) {
            const tk = this.t[j].t;
            if (tk === '{')
                bd++;
            else if (tk === '}')
                bd--;
            else if (tk === 'case' && bd === 1)
                total++;
        }
        const stop = () => { const x = this.peek(); return x === undefined || x === '}' || x === 'case' || x === 'default'; };
        this.p++; // '{'
        let i = 0;
        while (this.p < this.t.length && this.peek() !== '}') {
            const tk = this.peek();
            if (tk === 'case') {
                i++;
                const line = this.ln();
                this.skipLabel();
                this.condition(line, 'case', depth + i);
                while (!stop()) {
                    const b = this.p;
                    this.statement(depth + i);
                    if (this.p === b)
                        this.p++;
                }
            }
            else if (tk === 'default') {
                this.skipLabel();
                while (!stop()) {
                    const b = this.p;
                    this.statement(depth + total);
                    if (this.p === b)
                        this.p++;
                }
            }
            else {
                const b = this.p;
                this.statement(depth);
                if (this.p === b)
                    this.p++;
            }
        }
        this.p++; // '}'
    }
    run() {
        while (this.p < this.t.length) {
            const before = this.p;
            if (this.peek() === '}')
                this.p++;
            else
                this.statement(0);
            if (this.p === before)
                this.p++;
        }
        return {
            CL: this.cl,
            ops: this.ops,
            cl: this.ops ? this.cl / this.ops : 0,
            CLI: Math.max(this.maxLevel - 1, 0),
            McCabe: this.cl + 1,
            found: this.found,
        };
    }
}
function analyze(src) { return new Analyzer(src).run(); }
if (typeof module !== 'undefined')
    module.exports = { analyze };
