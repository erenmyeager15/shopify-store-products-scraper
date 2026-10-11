// Imported before the actual Actor entry point in local smoke tests.
// Any accidental live traffic makes the test fail, rather than spending money.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
const blocked = () => { throw new Error('Offline smoke test blocked a network operation.'); };
http.request = http.get = https.request = https.get = blocked;
net.connect = net.createConnection = net.Socket.prototype.connect = blocked;
dns.lookup = dns.resolve = dns.resolve4 = dns.resolve6 = blocked;
dns.promises.lookup = dns.promises.resolve = dns.promises.resolve4 = dns.promises.resolve6 = async () => blocked();
globalThis.fetch = async () => blocked();
syncBuiltinESMExports();
