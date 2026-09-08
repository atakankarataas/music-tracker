const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const path = require('node:path');
const assert = require('node:assert/strict');
globalThis.crypto ??= require('node:crypto').webcrypto;
// "server-only" is a bundler alias Next resolves at build time, not an
// installed package, so importing a server module outside Next would fail on it.
const load_ = Module._load;
Module._load = (request, ...rest) => request === 'server-only' ? {} : load_(request, ...rest);
function load(file) {
  const filename = path.resolve(file);
  const mod = new Module(filename, module);
  mod.paths = module.paths;
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
  return mod.exports;
}
(async () => {
  // CI must import routes without production database secrets. Queries must
  // still fail closed rather than fall back to writer credentials.
  const savedEnv = {...process.env};
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.WEB_DB_URI;
    process.env.DB_URI = 'must-not-use-writer';
    const {sql} = load('lib/db.ts');
    assert.equal(typeof sql, 'function');
    assert.throws(() => sql`SELECT 1`, /WEB_DB_URI must be configured/);
  } finally {
    delete process.env.WEB_DB_URI;
    process.env = savedEnv;
  }
  const auth = load('lib/auth.ts');
  const dates = load('lib/periods.ts');
  const realNow = Date.now;
  try {
    const now = realNow();
    Date.now = () => now;
    const fresh = await auth.createToken('listener','test-secret');
    assert.equal(await auth.verifyToken(fresh,'test-secret','listener'),true);
    assert.equal(await auth.verifyToken(fresh,'wrong-secret','listener'),false);
    assert.equal(await auth.verifyToken(fresh,'test-secret','other'),false);
    Date.now = () => now + auth.TOKEN_MAX_AGE * 1000;
    assert.equal(await auth.verifyToken(fresh,'test-secret','listener'),false);
    Date.now = () => now - 1;
    assert.equal(await auth.verifyToken(fresh,'test-secret','listener'),false);
    assert.equal(await auth.verifyToken('bad','test-secret','listener'),false);
  } finally { Date.now = realNow; }
  assert.deepEqual(dates.calendarRange('30d',undefined,undefined,'2026-09-07'),
    {period:'30d',start:'2026-08-09',end:'2026-09-07',error:null});
  assert.equal(dates.calendarRange('wrapped',undefined,undefined,'2026-01-01').start,'2026-01-01');
  assert.equal(dates.calendarRange('custom','2026-02-30','2026-03-01','2026-09-07').period,'30d');
  assert.equal(dates.calendarRange('custom','2026-09-07','2026-09-01','2026-09-07').period,'30d');
  assert.equal(dates.isIsoDate('2024-02-29'),true);
  assert.deepEqual(dates.wrappedRange('2024','2026-09-08'), {year:2024,currentYear:2026,start:'2024-01-01',end:'2024-12-31'});
  assert.equal(dates.wrappedRange('2027','2026-09-08').end,'2026-09-08');
  assert.equal(dates.wrappedRange('nope','2026-01-01').start,'2026-01-01');
  assert.equal(dates.wrappedRange('0000','2026-09-08').year,2026);
  assert.equal(dates.localToday(new Date('2025-12-31T21:05:00Z')),'2026-01-01');

  // nextUrl.origin reported localhost while the request arrived at 127.0.0.1,
  // so a real sign-in was rejected. The check compares Origin to the host the
  // browser actually addressed.
  const { isSameOrigin } = load('lib/origin.ts');
  const req = (headers) => ({ headers: { get: (name) => headers[name.toLowerCase()] ?? null } });
  assert.equal(isSameOrigin(req({origin:'http://127.0.0.1:3000',host:'127.0.0.1:3000'})),true);
  assert.equal(isSameOrigin(req({origin:'https://atakan.fm',host:'atakan.fm'})),true);
  assert.equal(isSameOrigin(req({origin:'https://atakan.fm','x-forwarded-host':'atakan.fm',host:'internal'})),true);
  assert.equal(isSameOrigin(req({origin:'https://evil.example',host:'atakan.fm'})),false);
  assert.equal(isSameOrigin(req({origin:'not a url',host:'atakan.fm'})),false);
  assert.equal(isSameOrigin(req({host:'atakan.fm'})),true);
  assert.equal(isSameOrigin(req({origin:'https://atakan.fm'})),false);

  console.log('Auth expiry, tampering, username, future timestamp, calendar boundary and same-origin tests passed.');
})().catch((error) => { console.error(error); process.exitCode=1; });
