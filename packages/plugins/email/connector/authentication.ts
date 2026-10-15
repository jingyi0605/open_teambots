/** Header lines of one message, unfolded, in their original top-to-bottom order. */
export function headerValues(raw: string, name: string): string[] {
  const unfolded = raw.replace(/\r?\n[ \t]+/g, " ");
  const prefix = `${name.toLowerCase()}:`;
  return unfolded
    .split(/\r?\n/)
    .filter((line) => line.toLowerCase().startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim());
}

const domainOf = (address: string) => address.split("@").pop()?.toLowerCase() ?? "";
/** Relaxed DMARC-style alignment: the signing and From domains match or one contains the other. */
const aligned = (fromDomain: string, signer: string) => {
  const domain = signer.toLowerCase().replace(/^@/, "").split("@").pop() ?? "";
  return (
    !!domain &&
    (fromDomain === domain ||
      fromDomain.endsWith(`.${domain}`) ||
      domain.endsWith(`.${fromDomain}`))
  );
};

/**
 * Whether the receiving server verified the From domain. Only the topmost
 * Authentication-Results header counts: the mailbox provider adds it on
 * arrival, while lower ones can be supplied by the sender. DMARC pass decides;
 * without a DMARC verdict, an aligned DKIM signature is accepted.
 */
export function senderAuthenticated(rawHeaders: string, fromAddress: string): boolean {
  const results = headerValues(rawHeaders, "Authentication-Results")[0];
  if (!results || !fromAddress.includes("@")) return false;
  const methods = results
    .split(";")
    .slice(1)
    .map((part) => part.trim().toLowerCase());
  const dmarc = methods.find((part) => part.startsWith("dmarc="));
  if (dmarc) {
    if (dmarc.startsWith("dmarc=pass")) return true;
    if (!/^dmarc=(none|temperror|neutral)\b/.test(dmarc)) return false;
  }
  const fromDomain = domainOf(fromAddress);
  return methods.some((part) => {
    if (!part.startsWith("dkim=pass")) return false;
    const signer = /header\.(?:d|i)=([^\s;]+)/.exec(part)?.[1];
    return !!signer && aligned(fromDomain, signer);
  });
}
