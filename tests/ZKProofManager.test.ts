// tests/ZKProofManager.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  Cl,
  ClarityValue,
  uintCV,
  buffCV,
  someCV,
  noneCV,
} from "@stacks/transactions";

const ERR_UNAUTHORIZED = 100;
const ERR_PROOF_EXISTS = 101;
const ERR_PROOF_NOT_FOUND = 102;
const ERR_INVALID_PROOF_TYPE = 103;
const ERR_INVALID_HASH = 104;
const ERR_VERIFIER_NOT_REGISTERED = 105;
const ERR_PROOF_REVOKED = 106;
const ERR_INVALID_EXPIRY = 107;
const ERR_PROOF_EXPIRED = 108;

const PROOF_TYPE_EDUCATION = 1;
const PROOF_TYPE_IDENTITY = 2;
const PROOF_TYPE_SKILL = 3;

interface Proof {
  owner: string;
  "proof-hash": Uint8Array;
  "proof-type": bigint;
  "issued-at": bigint;
  "expires-at"?: bigint | null;
  revoked: boolean;
  verifier: string;
}

interface Result<T> {
  isOk: boolean;
  value: T;
}

class ZKProofManagerMock {
  state = {
    nextProofId: 0n,
    admin: "ST1ADMIN",
    registeredVerifiers: new Map<string, boolean>(),
    proofMetadata: new Map<bigint, Proof>(),
    userProofs: new Map<string, bigint[]>(),
    proofHashIndex: new Map<string, bigint>(),
  };
  blockHeight = 1000n;
  caller = "ST1VERIFIER";

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextProofId: 0n,
      admin: "ST1ADMIN",
      registeredVerifiers: new Map(),
      proofMetadata: new Map(),
      userProofs: new Map(),
      proofHashIndex: new Map(),
    };
    this.blockHeight = 1000n;
    this.caller = "ST1VERIFIER";
  }

  setCaller(caller: string) {
    this.caller = caller;
  }

  setBlockHeight(height: bigint) {
    this.blockHeight = height;
  }

  registerVerifier(verifier: string): Result<boolean> {
    if (this.caller !== this.state.admin) return { isOk: false, value: false };
    this.state.registeredVerifiers.set(verifier, true);
    return { isOk: true, value: true };
  }

  isVerifier(verifier: string): boolean {
    return this.state.registeredVerifiers.get(verifier) ?? false;
  }

  issueZkProof(
    owner: string,
    proofHash: Uint8Array,
    proofType: number,
    expiresInBlocks?: bigint
  ): Result<bigint> {
    if (!this.isVerifier(this.caller))
      return { isOk: false, value: BigInt(ERR_VERIFIER_NOT_REGISTERED) };
    if (
      ![PROOF_TYPE_EDUCATION, PROOF_TYPE_IDENTITY, PROOF_TYPE_SKILL].includes(
        proofType
      )
    )
      return { isOk: false, value: BigInt(ERR_INVALID_PROOF_TYPE) };
    if (proofHash.length === 0)
      return { isOk: false, value: BigInt(ERR_INVALID_HASH) };

    const hashKey = Buffer.from(proofHash).toString("hex");
    if (this.state.proofHashIndex.has(hashKey))
      return { isOk: false, value: BigInt(ERR_PROOF_EXISTS) };

    const proofId = this.state.nextProofId;
    const expiresAt = expiresInBlocks
      ? this.blockHeight + expiresInBlocks
      : undefined;

    const proof: Proof = {
      owner,
      "proof-hash": proofHash,
      "proof-type": BigInt(proofType),
      "issued-at": this.blockHeight,
      "expires-at": expiresAt,
      revoked: false,
      verifier: this.caller,
    };

    this.state.proofMetadata.set(proofId, proof);
    this.state.proofHashIndex.set(hashKey, proofId);

    const userList = this.state.userProofs.get(owner) || [];
    if (userList.length >= 100)
      return { isOk: false, value: BigInt(ERR_UNAUTHORIZED) };
    this.state.userProofs.set(owner, [...userList, proofId]);

    this.state.nextProofId += 1n;
    return { isOk: true, value: proofId };
  }

  getProof(proofId: bigint): Proof | null {
    return this.state.proofMetadata.get(proofId) ?? null;
  }

  getUserProofs(user: string): bigint[] {
    return this.state.userProofs.get(user) || [];
  }

  revokeProof(proofId: bigint): Result<boolean> {
    const proof = this.state.proofMetadata.get(proofId);
    if (!proof) return { isOk: false, value: false };
    if (this.caller !== proof.verifier && this.caller !== this.state.admin)
      return { isOk: false, value: false };

    this.state.proofMetadata.set(proofId, { ...proof, revoked: true });
    return { isOk: true, value: true };
  }

  verifyProofOwnership(proofId: bigint, claimedOwner: string): Result<boolean> {
    const proof = this.state.proofMetadata.get(proofId);
    if (!proof) return { isOk: false, value: false };

    const expired = proof["expires-at"]
      ? this.blockHeight >= proof["expires-at"]!
      : false;
    if (proof.revoked || expired) return { isOk: false, value: false };
    if (proof.owner !== claimedOwner) return { isOk: false, value: false };

    return { isOk: true, value: true };
  }

  isProofValid(proofId: bigint): boolean {
    const proof = this.state.proofMetadata.get(proofId);
    if (!proof) return false;
    const expired = proof["expires-at"]
      ? this.blockHeight >= proof["expires-at"]!
      : false;
    return !proof.revoked && !expired;
  }

  transferAdmin(newAdmin: string): Result<boolean> {
    if (this.caller !== this.state.admin) return { isOk: false, value: false };
    this.state.admin = newAdmin;
    return { isOk: true, value: true };
  }
}

describe("ZKProofManager", () => {
  let mock: ZKProofManagerMock;

  beforeEach(() => {
    mock = new ZKProofManagerMock();
    mock.reset();
  });

  it("registers verifier successfully", () => {
    mock.setCaller("ST1ADMIN");
    const result = mock.registerVerifier("ST1VERIFIER");
    expect(result.isOk).toBe(true);
    expect(mock.isVerifier("ST1VERIFIER")).toBe(true);
  });

  it("rejects non-admin verifier registration", () => {
    mock.setCaller("ST1HACKER");
    const result = mock.registerVerifier("ST1VERIFIER");
    expect(result.isOk).toBe(false);
  });

  it("issues education proof with expiry", () => {
    mock.setCaller("ST1ADMIN");
    mock.registerVerifier("ST1VERIFIER");
    mock.setCaller("ST1VERIFIER");

    const hash = Buffer.from("proofhash12345678901234567890123", "utf8");
    const result = mock.issueZkProof(
      "ST1REFUGEE",
      hash,
      PROOF_TYPE_EDUCATION,
      1000n
    );

    expect(result.isOk).toBe(true);
    expect(result.value).toBe(0n);

    const proof = mock.getProof(0n);
    expect(proof?.owner).toBe("ST1REFUGEE");
    expect(proof?.["proof-type"]).toBe(1n);
    expect(proof?.["expires-at"]).toBe(2000n);
    expect(mock.getUserProofs("ST1REFUGEE")).toEqual([0n]);
  });

  it("rejects duplicate proof hash", () => {
    mock.setCaller("ST1ADMIN");
    mock.registerVerifier("ST1VERIFIER");
    mock.setCaller("ST1VERIFIER");

    const hash = Buffer.from("samehash", "utf8");
    mock.issueZkProof("ST1A", hash, PROOF_TYPE_EDUCATION);
    const result = mock.issueZkProof("ST1B", hash, PROOF_TYPE_IDENTITY);

    expect(result.isOk).toBe(false);
    expect(result.value).toBe(BigInt(ERR_PROOF_EXISTS));
  });

  it("revokes proof by verifier", () => {
    mock.setCaller("ST1ADMIN");
    mock.registerVerifier("ST1VERIFIER");
    mock.setCaller("ST1VERIFIER");

    const hash = Buffer.from("revokeme", "utf8");
    mock.issueZkProof("ST1USER", hash, PROOF_TYPE_SKILL);

    const revoke = mock.revokeProof(0n);
    expect(revoke.isOk).toBe(true);

    const proof = mock.getProof(0n);
    expect(proof?.revoked).toBe(true);
  });

  it("verifies proof ownership correctly", () => {
    mock.setCaller("ST1ADMIN");
    mock.registerVerifier("ST1VERIFIER");
    mock.setCaller("ST1VERIFIER");

    const hash = Buffer.from("validproof", "utf8");
    mock.issueZkProof("ST1OWNER", hash, PROOF_TYPE_EDUCATION);

    const verify = mock.verifyProofOwnership(0n, "ST1OWNER");
    expect(verify.isOk).toBe(true);
    expect(verify.value).toBe(true);

    const wrong = mock.verifyProofOwnership(0n, "ST1HACKER");
    expect(wrong.isOk).toBe(false);
  });

  it("expires proof after block height", () => {
    mock.setCaller("ST1ADMIN");
    mock.registerVerifier("ST1VERIFIER");
    mock.setCaller("ST1VERIFIER");

    const hash = Buffer.from("expireme", "utf8");
    mock.issueZkProof("ST1USER", hash, PROOF_TYPE_EDUCATION, 10n);

    mock.setBlockHeight(1011n);
    const valid = mock.isProofValid(0n);
    expect(valid).toBe(false);
  });

  it("prevents issuance by unregistered verifier", () => {
    mock.setCaller("ST1UNREGISTERED");
    const result = mock.issueZkProof(
      "ST1USER",
      Buffer.from("hash"),
      PROOF_TYPE_EDUCATION
    );
    expect(result.isOk).toBe(false);
    expect(result.value).toBe(BigInt(ERR_VERIFIER_NOT_REGISTERED));
  });

  it("transfers admin successfully", () => {
    mock.setCaller("ST1ADMIN");
    const result = mock.transferAdmin("ST1NEWADMIN");
    expect(result.isOk).toBe(true);
    mock.setCaller("ST1NEWADMIN");
    expect(mock.registerVerifier("ST1VERIFIER").isOk).toBe(true);
  });

  it("limits user proofs to 100", () => {
    mock.setCaller("ST1ADMIN");
    mock.registerVerifier("ST1VERIFIER");
    mock.setCaller("ST1VERIFIER");

    for (let i = 0; i < 100; i++) {
      const hash = Buffer.from(`hash${i}`, "utf8");
      mock.issueZkProof("ST1USER", hash, PROOF_TYPE_EDUCATION);
    }

    const hash101 = Buffer.from("hash101", "utf8");
    const result = mock.issueZkProof("ST1USER", hash101, PROOF_TYPE_SKILL);
    expect(result.isOk).toBe(false);
  });
});
