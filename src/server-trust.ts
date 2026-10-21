import crypto from 'node:crypto';
import net from 'node:net';

/** A pin narrows trust to an exact certificate; it never bypasses hostname or expiry checks. */
export function verifyPinnedCertificate(pem:string,hostname:string,expected:string,now=Date.now()):boolean {
  try {
    if(!/^[a-f0-9]{64}$/.test(expected)) return false;
    const certificate=new crypto.X509Certificate(pem);
    const fingerprint=crypto.createHash('sha256').update(certificate.raw).digest('hex');
    const host=hostname.replace(/^\[|\]$/g,'');
    const matches=net.isIP(host)?certificate.checkIP(host):certificate.checkHost(host);
    return fingerprint===expected && !!matches && Date.parse(certificate.validFrom)<=now && now<Date.parse(certificate.validTo);
  } catch {return false;}
}
