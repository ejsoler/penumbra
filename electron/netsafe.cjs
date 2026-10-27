// Shared network safety checks for anything model-driven (widgets and agent web tools): nothing may
// reach this computer, the local network, or link-local/multicast addresses, even through DNS.
const dns = require('dns').promises;
const net = require('net');

const privateNets = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 3]]) {
  privateNets.addSubnet(a, p, 'ipv4');
}
for (const [a, p] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) privateNets.addSubnet(a, p, 'ipv6');
const isPrivateIp = (ip) => {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (v4) return privateNets.check(v4, 'ipv4');
  return privateNets.check(ip, net.isIP(ip) === 6 ? 'ipv6' : 'ipv4');
};

const dnsCache = new Map();
async function resolvesToPrivate(host) {
  const hit = dnsCache.get(host);
  if (hit && Date.now() - hit.at < 60_000) return hit.private;
  let result = false;
  try {
    result = (await dns.lookup(host, { all: true })).some((a) => isPrivateIp(a.address));
  } catch {
    /* unresolvable: the request will fail on its own */
  }
  dnsCache.set(host, { at: Date.now(), private: result });
  return result;
}

/** Names that always mean this computer or the local network. */
const isLocalName = (host) => /^(localhost|.*\.(localhost|local|internal|lan|home\.arpa))$/i.test(host);

module.exports = { isPrivateIp, resolvesToPrivate, isLocalName };
