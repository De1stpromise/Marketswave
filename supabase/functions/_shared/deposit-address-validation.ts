// ★ Crypto deposit routing (2026-09-11) — structural address validation.
//
// ★ THE INVESTIGATION, AND WHERE IT LANDED. A mistyped deposit address is unrecoverable, so
// the question was whether to validate by format per network. Two very different things
// hide under "validate":
//
//   STRUCTURAL — prefix, character set, length. Catches the realistic paste errors: a
//   truncated copy, a trailing space, a TRON address pasted into the Bitcoin slot, an
//   0x address with a missing character. ~40 lines, zero dependencies, no false rejections
//   of a correctly-pasted address. BUILT — this file.
//
//   CHECKSUM — bech32 polymod for Bitcoin, base58check (double SHA-256) for legacy Bitcoin
//   and TRON, EIP-55 mixed-case for Ethereum. Catches a single wrong character INSIDE an
//   otherwise well-formed address. NOT BUILT, deliberately: EIP-55 needs keccak-256, which
//   Deno's Web Crypto does not ship, so it means a dependency; base58check is ~80 more
//   lines for two networks; and — the deciding point — the PM is pasting from their own
//   wallet, where the address was generated, not typing it. A single-character transcription
//   error is the case checksums exist for, and it is not the case this form produces. A
//   retype-to-confirm field was also considered and rejected as theatre: pasting the same
//   clipboard twice confirms nothing.
//
//   What structural validation does NOT catch, stated plainly: a well-formed address that
//   belongs to someone else. Nothing client-side can. That is the reason the Add Address
//   confirmation modal shows the address back in full before saving.
//
// Shared by add-deposit-address (the only writer) and kept here so any future writer
// validates identically — the same drift-prevention discipline as hys-engine.ts.

export type AddressFormat = 'btc' | 'evm' | 'tron';

const BECH32_CHARSET = /^[02-9ac-hj-np-z]+$/; // bech32: no 1, b, i, o
const BASE58_CHARSET = /^[1-9A-HJ-NP-Za-km-z]+$/; // base58: no 0, O, I, l

export function validateDepositAddress(format: AddressFormat, rawAddress: unknown): string | null {
  if (typeof rawAddress !== 'string') return 'address is required.';
  const address = rawAddress.trim();
  if (address.length === 0) return 'address is required.';
  if (address !== rawAddress) {
    // Reject rather than silently trim: a PM should see that what they pasted carried
    // whitespace, since the same clipboard may be pasted elsewhere.
    return 'address must not begin or end with whitespace.';
  }
  if (/\s/.test(address)) return 'address must not contain spaces.';

  switch (format) {
    case 'btc': {
      // Bech32 / bech32m (bc1q..., bc1p...): 42 chars for P2WPKH, 62 for P2WSH/P2TR; the
      // spec bounds any bech32 string at 90. Legacy P2PKH (1...) / P2SH (3...): 26-35
      // base58 chars. Testnet prefixes are deliberately not accepted.
      if (/^bc1/i.test(address)) {
        const body = address.slice(3).toLowerCase();
        if (address !== address.toLowerCase() && address !== address.toUpperCase()) {
          return 'a bech32 Bitcoin address must be all lower-case (mixed case is invalid).';
        }
        if (body.length < 6 || address.length > 90) return 'this does not look like a valid Bitcoin address (length).';
        if (!BECH32_CHARSET.test(body)) return 'this does not look like a valid Bitcoin address (invalid characters for bech32).';
        if (address.length !== 42 && address.length !== 62) {
          return 'this does not look like a standard Bitcoin address (expected 42 or 62 characters for bc1...).';
        }
        return null;
      }
      if (/^[13]/.test(address)) {
        if (address.length < 26 || address.length > 35) return 'this does not look like a valid Bitcoin address (length).';
        if (!BASE58_CHARSET.test(address)) return 'this does not look like a valid Bitcoin address (invalid characters).';
        return null;
      }
      return 'a Bitcoin address starts with bc1, 1, or 3.';
    }
    case 'evm': {
      // Ethereum / ERC-20: 0x followed by exactly 40 hex characters. Case is not checked
      // (EIP-55 is a checksum, see the header), only the character set.
      if (!/^0x/i.test(address)) return 'an Ethereum (ERC-20) address starts with 0x.';
      if (address.length !== 42) return 'an Ethereum (ERC-20) address is exactly 42 characters (0x + 40).';
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return 'an Ethereum (ERC-20) address contains only hexadecimal characters after 0x.';
      return null;
    }
    case 'tron': {
      // TRON mainnet (TRC-20): base58check, always 34 characters, always starts with T.
      if (!/^T/.test(address)) return 'a TRON (TRC-20) address starts with T.';
      if (address.length !== 34) return 'a TRON (TRC-20) address is exactly 34 characters.';
      if (!BASE58_CHARSET.test(address)) return 'a TRON (TRC-20) address contains invalid characters.';
      return null;
    }
    default:
      return 'unknown address format.';
  }
}

export function toAddressClientShape(row: Record<string, unknown>) {
  return {
    id: row.id,
    currency: row.currency,
    network: row.network,
    address: row.address,
    label: row.label,
    status: row.status,
    createdBy: row.created_by,
    createdByEmail: row.created_by_email,
    createdAt: row.created_at,
    retiredAt: row.retired_at
  };
}

export function toAssignmentClientShape(row: Record<string, unknown>) {
  return {
    id: row.id,
    addressId: row.address_id,
    clientId: row.client_id,
    currency: row.currency,
    network: row.network,
    assignedBy: row.assigned_by,
    assignedByEmail: row.assigned_by_email,
    assignedAt: row.assigned_at,
    removedAt: row.removed_at,
    removedBy: row.removed_by,
    removedByEmail: row.removed_by_email
  };
}
