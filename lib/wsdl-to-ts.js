"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.outputTypedWsdl = exports.mergeTypedWsdl = exports.wsdl2ts = exports.TypeCollector = exports.nsEnums = void 0;
const wsdl_1 = require("soap/lib/wsdl");
// import { diffLines } from "diff";
exports.nsEnums = {};
class TypeCollector {
    constructor(ns) {
        this.ns = ns;
        this.registered = {};
        this.collected = {};
    }
    registerCollected() {
        for (const k of Object.keys(this.collected)) {
            if (this.collected[k]) {
                this.registered[k] = this.collected[k];
            }
            else {
                delete this.registered[k];
            }
            delete this.collected[k];
        }
        return this;
    }
}
exports.TypeCollector = TypeCollector;
const predefinedTypeClass = {
    integer: "number",
    dateTime: "Date",
    unsignedLong: "number",
    double: "number",
    decimal: "number",
    long: "number"
};
function wsdlTypeToInterfaceObj(obj, typeCollector) {
    const r = {};
    for (const k of Object.keys(obj)) {
        if (k === "targetNSAlias" || k === "targetNamespace") {
            continue;
        }
        const isArray = k.endsWith("[]");
        const k2 = isArray ? k.substring(0, k.length - 2) : k;
        const v = obj[k];
        const t = typeof v;
        if (t === "string") {
            const vstr = v;
            const [typeName, superTypeClass, typeData] = vstr.indexOf("|") === -1 ? [vstr, vstr, undefined] : vstr.split("|");
            const typeFullName = obj.targetNamespace ? obj.targetNamespace + "#" + typeName : typeName;
            let typeClass = predefinedTypeClass[superTypeClass] ? predefinedTypeClass[superTypeClass] : superTypeClass;
            if (exports.nsEnums[typeFullName] || typeData) {
                const filter = exports.nsEnums[typeFullName] ?
                    () => true :
                    (x) => x !== "length" && x !== "pattern" && x !== "maxLength" && x !== "minLength";
                const tdsplit = typeData.split(",").filter(filter);
                if (tdsplit.length) {
                    typeClass = "\"" + tdsplit.join("\" | \"") + "\"";
                }
            }
            if (isArray) {
                if (/^[A-Za-z0-9.]+$/.test(typeClass)) {
                    typeClass += "[]";
                }
                else {
                    typeClass = "Array<" + typeClass + ">";
                }
            }
            r[k2] = "/** " + typeFullName + "(" + typeData + ") */ " + typeClass + ";";
        }
        else {
            const to = wsdlTypeToInterfaceObj(v, typeCollector);
            let tr;
            if (isArray) {
                let s = wsdlTypeToInterfaceString(to);
                if (typeCollector && typeCollector.ns) {
                    if (typeCollector.registered.hasOwnProperty(k2) && typeCollector.registered[k2] === s) {
                        s = typeCollector.ns + ".I" + k2 + ";";
                    }
                    else if (typeCollector.collected.hasOwnProperty(k2)) {
                        if (typeCollector.collected[k2] !== s) {
                            typeCollector.collected[k2] = null;
                        }
                    }
                    else {
                        typeCollector.collected[k2] = s;
                    }
                }
                s = s.replace(/\n/g, "\n    ");
                if (s.startsWith("/**")) {
                    const i = s.indexOf("*/") + 2;
                    s = s.substring(0, i) + " Array<" + s.substring(i).trim().replace(/;$/, "") + ">;";
                }
                else {
                    s = s.trim().replace(/;$/, "");
                    if (/^[A-Za-z0-9.]+$/.test(s)) {
                        s += "[];";
                    }
                    else {
                        s = "Array<" + s + ">;";
                    }
                }
                tr = s;
            }
            else {
                tr = to;
                if (typeCollector && typeCollector.ns) {
                    const ss = wsdlTypeToInterfaceString(to);
                    if (typeCollector.registered.hasOwnProperty(k2) && typeCollector.registered[k2] === ss) {
                        tr = typeCollector.ns + ".I" + k2 + ";";
                    }
                    else if (typeCollector.collected.hasOwnProperty(k2)) {
                        if (typeCollector.collected[k2] !== ss) {
                            typeCollector.collected[k2] = null;
                        }
                    }
                    else {
                        typeCollector.collected[k2] = ss;
                    }
                }
            }
            r[k2] = tr;
        }
    }
    // console.log("wsdlTypeToInterfaceObj:", r);
    return r;
}
function wsdlTypeToInterfaceString(d, opts = {}) {
    const r = [];
    for (const k of Object.keys(d)) {
        const t = typeof d[k];
        let p = k;
        if (opts.quoteProperties || (opts.quoteProperties === undefined && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(k))) {
            p = JSON.stringify(k);
        }
        if (t === "string") {
            const v = d[k];
            if (v.startsWith("/**")) {
                const i = v.indexOf("*/") + 2;
                r.push(v.substring(0, i));
                // for types like "xsd:string" only the "string" part is used
                const rawtype = v.substring(i).trim();
                const colon = rawtype.indexOf(":");
                if (colon !== -1) {
                    r.push(p + ": " + rawtype.substring(colon + 1));
                }
                else {
                    r.push(p + ": " + rawtype);
                }
            }
            else {
                r.push(p + ": " + v);
            }
        }
        else {
            r.push(p + ": " + wsdlTypeToInterfaceString(d[k], opts).replace(/\n/g, "\n    ") + ";");
        }
    }
    if (r.length === 0) {
        return "{}";
    }
    return "{\n    " + r.join("\n    ") + "\n}";
}
function wsdlTypeToInterface(obj, typeCollector, opts) {
    return wsdlTypeToInterfaceString(wsdlTypeToInterfaceObj(obj, typeCollector), opts);
}
function wsdl2ts(wsdlUri, opts) {
    return new Promise((resolve, reject) => {
        (0, wsdl_1.open_wsdl)(wsdlUri, (err, wsdl) => {
            return err ? reject(err) : resolve(wsdl);
        });
    }).then((wsdl) => {
        const r = {
            client: null,
            files: {},
            methods: {},
            namespaces: {},
            types: {},
        };
        const d = wsdl.describeServices();
        for (const service of Object.keys(d)) {
            for (const port of Object.keys(d[service])) {
                const collector = new TypeCollector(port + "Types");
                // console.log("-- %s.%s", service, port);
                if (!r.types[service]) {
                    r.types[service] = {};
                    r.methods[service] = {};
                    r.files[service] = {};
                    r.namespaces[service] = {};
                }
                if (!r.types[service][port]) {
                    r.types[service][port] = {};
                    r.methods[service][port] = {};
                    r.files[service][port] = service + "/" + port;
                    r.namespaces[service][port] = {};
                }
                for (let maxi = 0; maxi < 32; maxi++) {
                    for (const method of Object.keys(d[service][port])) {
                        // console.log("---- %s", method);
                        wsdlTypeToInterface(d[service][port][method].input || {}, collector, opts);
                        wsdlTypeToInterface(d[service][port][method].output || {}, collector, opts);
                    }
                    const reg = cloneObj(collector.registered);
                    collector.registerCollected();
                    const regKeys0 = Object.keys(collector.registered);
                    const regKeys1 = Object.keys(reg);
                    if (regKeys0.length === regKeys1.length) {
                        let noChange = true;
                        for (const rk of regKeys0) {
                            if (collector.registered[rk] !== reg[rk]) {
                                noChange = false;
                                break;
                            }
                        }
                        if (noChange) {
                            break;
                        }
                    }
                    if (maxi === 31) {
                        console.warn("wsdl-to-ts: Aborted nested interface changes");
                    }
                }
                const collectedKeys = Object.keys(collector.registered);
                if (collectedKeys.length) {
                    const ns = r.namespaces[service][port][collector.ns] = {};
                    for (const k of collectedKeys) {
                        ns[k] = "export interface I" + k + " " + collector.registered[k];
                    }
                }
                for (const method of Object.keys(d[service][port])) {
                    r.types[service][port]["I" + method + "Input"] =
                        wsdlTypeToInterface(d[service][port][method].input || {}, collector, opts);
                    r.types[service][port]["I" + method + "Output"] =
                        wsdlTypeToInterface(d[service][port][method].output || {}, collector, opts);
                    r.methods[service][port][method] =
                        "(input: I" + method + "Input," +
                            " headers: {[k: string]: any; }," +
                            " request: IncomingMessage" +
                            ") => I" + method + "Output | Promise<I" + method + "Output>";
                }
            }
        }
        return r;
    });
}
exports.wsdl2ts = wsdl2ts;
function cloneObj(a) {
    const b = {};
    for (const k of Object.keys(a)) {
        const t = typeof a[k];
        b[k] = t === "object" ?
            Array.isArray(a[k]) ? a[k].slice() : cloneObj(a[k]) : a[k];
    }
    return b;
}
function mergeTypedWsdl(a, ...bs) {
    const x = {
        client: null,
        files: cloneObj(a.files),
        methods: cloneObj(a.methods),
        namespaces: cloneObj(a.namespaces),
        types: cloneObj(a.types),
    };
    for (const b of bs) {
        for (const service of Object.keys(b.files)) {
            if (!x.files.hasOwnProperty(service)) {
                x.files[service] = cloneObj(b.files[service]);
                x.methods[service] = cloneObj(b.methods[service]);
                x.types[service] = cloneObj(b.types[service]);
                x.namespaces[service] = cloneObj(b.namespaces[service]);
            }
            else {
                for (const port of Object.keys(b.files[service])) {
                    if (!x.files[service].hasOwnProperty(port)) {
                        x.files[service][port] = b.files[service][port];
                        x.methods[service][port] = cloneObj(b.methods[service][port]);
                        x.types[service][port] = cloneObj(b.types[service][port]);
                        x.namespaces[service][port] = cloneObj(b.namespaces[service][port]);
                    }
                    else {
                        x.files[service][port] = b.files[service][port];
                        for (const method of Object.keys(b.methods[service][port])) {
                            x.methods[service][port][method] = b.methods[service][port][method];
                        }
                        for (const type of Object.keys(b.types[service][port])) {
                            x.types[service][port][type] = b.types[service][port][type];
                        }
                        for (const ns of Object.keys(b.namespaces[service][port])) {
                            if (!x.namespaces[service][port].hasOwnProperty(ns)) {
                                x.namespaces[service][port][ns] = cloneObj(b.namespaces[service][port][ns]);
                            }
                            else {
                                for (const nsi of Object.keys(b.namespaces[service][port][ns])) {
                                    x.namespaces[service][port][ns][nsi] = b.namespaces[service][port][ns][nsi];
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    return x;
}
exports.mergeTypedWsdl = mergeTypedWsdl;
function outputTypedWsdl(a) {
    const r = [];
    for (const service of Object.keys(a.files)) {
        for (const port of Object.keys(a.files[service])) {
            const d = { file: a.files[service][port], data: [] };
            d.data.push("import {IncomingMessage} from 'http'");
            if (a.types[service] && a.types[service][port]) {
                for (const type of Object.keys(a.types[service][port])) {
                    d.data.push("export interface " + type + " " + a.types[service][port][type]);
                }
            }
            if (a.methods[service] && a.methods[service][port]) {
                const ms = [];
                for (const method of Object.keys(a.methods[service][port])) {
                    ms.push(method + ": " + a.methods[service][port][method] + ";");
                }
                if (ms.length) {
                    d.data.push("export interface I" + port + "Soap {\n    " + ms.join("\n    ") + "\n}");
                }
            }
            if (a.namespaces[service] && a.namespaces[service][port]) {
                for (const ns of Object.keys(a.namespaces[service][port])) {
                    const ms = [];
                    for (const nsi of Object.keys(a.namespaces[service][port][ns])) {
                        ms.push(a.namespaces[service][port][ns][nsi].replace(/\n/g, "\n    "));
                    }
                    if (ms.length) {
                        d.data.push("export namespace " + ns + " {\n    " + ms.join("\n    ") + "\n}");
                    }
                }
            }
            r.push(d);
        }
    }
    return r;
}
exports.outputTypedWsdl = outputTypedWsdl;
//# sourceMappingURL=wsdl-to-ts.js.map