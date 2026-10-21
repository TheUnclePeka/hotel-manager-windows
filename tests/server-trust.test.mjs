import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {verifyPinnedCertificate} from '../src/server-trust.ts';
const pem=fs.readFileSync(new URL('./fixtures/synthetic-certificate.txt',import.meta.url),'utf8');
const cert=new crypto.X509Certificate(pem);
const hash=crypto.createHash('sha256').update(cert.raw).digest('hex');
const now=Date.parse(cert.validFrom)+60000;
test('accepts only the certificate explicitly received for this server',()=>assert.equal(verifyPinnedCertificate(pem,'127.0.0.1',hash,now),true));
test('rejects a different pin',()=>assert.equal(verifyPinnedCertificate(pem,'127.0.0.1','0'.repeat(64),now),false));
test('rejects the correct certificate at a different host',()=>assert.equal(verifyPinnedCertificate(pem,'127.0.0.2',hash,now),false));
test('rejects expired and not-yet-valid certificates',()=>{
  assert.equal(verifyPinnedCertificate(pem,'127.0.0.1',hash,Date.parse(cert.validTo)+1),false);
  assert.equal(verifyPinnedCertificate(pem,'127.0.0.1',hash,Date.parse(cert.validFrom)-1),false);
});
test('rejects malformed certificates',()=>assert.equal(verifyPinnedCertificate('invalid','127.0.0.1',hash,now),false));
