// tests/CredentialIssuer.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  Cl,
  uintCV,
  buffCV,
  someCV,
  noneCV,
  principalCV,
} from "@stacks/transactions";

const ERR_UNAUTHORIZED = 100;
const ERR_PROOF_NOT_FOUND = 101;
const ERR_PROOF_INVALID = 102;
const ERR_INSTITUTION_NOT_REGISTERED = 103;
const ERR_CREDENTIAL_EXISTS = 104;
const ERR_INVALID_CREDENTIAL_TYPE = 105;
const ERR_REFUGEE_NOT_OWNER = 106;
const ERR_CREDENTIAL_REVOKED = 107;
const ERR_EXPIRY_PAST = 108;

const CRED_EDUCATION = 1;
const CRED_CERTIFICATION = 2;
const CRED_COURSE = 3;

interface Credential {
  refugee: string;
  institution: string;
  "credential-type": bigint;
  "proof-id": bigint;
  "issued-at": bigint;
  "expires-at"?: bigint | null;
  revoked: boolean;
  "metadata-hash": Uint8Array;
  title: string;
  description: string;
}

interface Result<T> {
  isOk: boolean;
  value: T;
}

class ZKProofMock {
  verifyProofOwnership(proofId: bigint, owner: string): Result<boolean> {
    if (proofId === 999n) return { isOk: false, value: false };
    return { isOk: true, value: owner === "ST1REFUGEE" };
  }
  isProofValid(proofId: bigint): Result<boolean> {
    if (proofId === 888n) return { isOk: true, value: false };
    return { isOk: true, value: true };
  }
}

class CredentialIssuerMock {
  state = {
    zkProofContract: "ST1ZK",
    institutionRegistry: "ST1REG",
    nextCredentialId: 0n,
    registeredInstitutions: new Map<string, boolean>(),
    credentials: new Map<bigint, Credential>(),
    credentialByProof: new Map<bigint, bigint>(),
    refugeeCredentials: new Map<string, bigint[]>(),
  };
  blockHeight = 2000n;
  caller = "ST1INST";
  zkProof = new ZKProofMock();

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      zkProofContract: "ST1ZK",
      institutionRegistry: "ST1REG",
      nextCredentialId: 0n,
      registeredInstitutions: new Map(),
      credentials: new Map(),
      credentialByProof: new Map(),
      refugeeCredentials: new Map(),
    };
    this.blockHeight = 2000n;
    this.caller = "ST1INST";
  }

  setCaller(caller: string) {
    this.caller = caller;
  }

  setBlockHeight(height: bigint) {
    this.blockHeight = height;
  }

  setZkProofContract(contract: string): Result<boolean> {
    if (this.caller !== this.state.institutionRegistry)
      return { isOk: false, value: false };
    this.state.zkProofContract = contract;
    return { isOk: true, value: true };
  }

  registerInstitution(inst: string): Result<boolean> {
    if (this.caller !== this.state.institutionRegistry)
      return { isOk: false, value: false };
    this.state.registeredInstitutions.set(inst, true);
    return { isOk: true, value: true };
  }

  isInstitution(inst: string): boolean {
    return this.state.registeredInstitutions.get(inst) ?? false;
  }

  issueCredential(
    refugee: string,
    proofId: bigint,
    credType: number,
    expiresInBlocks?: bigint,
    metadataHash?: Uint8Array,
    title?: string,
    description?: string
  ): Result<bigint> {
    if (!this.isInstitution(this.caller))
      return { isOk: false, value: BigInt(ERR_INSTITUTION_NOT_REGISTERED) };
    if (![CRED_EDUCATION, CRED_CERTIFICATION, CRED_COURSE].includes(credType))
      return { isOk: false, value: BigInt(ERR_INVALID_CREDENTIAL_TYPE) };
    if (!metadataHash || metadataHash.length === 0)
      return { isOk: false, value: BigInt(ERR_UNAUTHORIZED) };
    if (!title || title.length === 0)
      return { isOk: false, value: BigInt(ERR_UNAUTHORIZED) };

    const zkOwn = this.zkProof.verifyProofOwnership(proofId, refugee);
    if (!zkOwn.isOk || !zkOwn.value)
      return { isOk: false, value: BigInt(ERR_REFUGEE_NOT_OWNER) };

    const zkValid = this.zkProof.isProofValid(proofId);
    if (!zkValid.isOk || !zkValid.value)
      return { isOk: false, value: BigInt(ERR_PROOF_INVALID) };

    if (this.state.credentialByProof.has(proofId))
      return { isOk: false, value: BigInt(ERR_CREDENTIAL_EXISTS) };

    const credId = this.state.nextCredentialId;
    const expiresAt = expiresInBlocks
      ? this.blockHeight + expiresInBlocks
      : undefined;

    const cred: Credential = {
      refugee,
      institution: this.caller,
      "credential-type": BigInt(credType),
      "proof-id": proofId,
      "issued-at": this.blockHeight,
      "expires-at": expiresAt,
      revoked: false,
      "metadata-hash": metadataHash,
      title: title!,
      description: description || "",
    };

    this.state.credentials.set(credId, cred);
    this.state.credentialByProof.set(proofId, credId);

    const list = this.state.refugeeCredentials.get(refugee) || [];
    if (list.length >= 50)
      return { isOk: false, value: BigInt(ERR_UNAUTHORIZED) };
    this.state.refugeeCredentials.set(refugee, [...list, credId]);

    this.state.nextCredentialId += 1n;
    return { isOk: true, value: credId };
  }

  getCredential(credId: bigint): Credential | null {
    return this.state.credentials.get(credId) ?? null;
  }

  getCredentialsByRefugee(refugee: string): bigint[] {
    return this.state.refugeeCredentials.get(refugee) || [];
  }

  revokeCredential(credId: bigint): Result<boolean> {
    const cred = this.state.credentials.get(credId);
    if (!cred) return { isOk: false, value: false };
    if (
      this.caller !== cred.institution &&
      this.caller !== this.state.institutionRegistry
    )
      return { isOk: false, value: false };
    this.state.credentials.set(credId, { ...cred, revoked: true });
    return { isOk: true, value: true };
  }

  verifyCredential(credId: bigint, refugee: string): Result<boolean> {
    const cred = this.state.credentials.get(credId);
    if (!cred) return { isOk: false, value: false };
    const expired = cred["expires-at"]
      ? this.blockHeight >= cred["expires-at"]!
      : false;
    if (cred.revoked || expired || cred.refugee !== refugee)
      return { isOk: false, value: false };
    return { isOk: true, value: true };
  }

  isCredentialValid(credId: bigint): boolean {
    const cred = this.state.credentials.get(credId);
    if (!cred) return false;
    const expired = cred["expires-at"]
      ? this.blockHeight >= cred["expires-at"]!
      : false;
    return !cred.revoked && !expired;
  }
}

describe("CredentialIssuer", () => {
  let mock: CredentialIssuerMock;

  beforeEach(() => {
    mock = new CredentialIssuerMock();
    mock.reset();
  });

  it("registers institution via registry", () => {
    mock.setCaller("ST1REG");
    const result = mock.registerInstitution("ST1INST");
    expect(result.isOk).toBe(true);
    expect(mock.isInstitution("ST1INST")).toBe(true);
  });

  it("issues education credential successfully", () => {
    mock.setCaller("ST1REG");
    mock.registerInstitution("ST1INST");
    mock.setCaller("ST1INST");

    const hash = Buffer.from("metahash12345678901234567890123", "utf8");
    const result = mock.issueCredential(
      "ST1REFUGEE",
      1n,
      CRED_EDUCATION,
      5000n,
      hash,
      "Bachelor of Science",
      "Completed with honors"
    );

    expect(result.isOk).toBe(true);
    expect(result.value).toBe(0n);

    const cred = mock.getCredential(0n);
    expect(cred?.refugee).toBe("ST1REFUGEE");
    expect(cred?.["credential-type"]).toBe(1n);
    expect(cred?.title).toBe("Bachelor of Science");
    expect(cred?.["expires-at"]).toBe(7000n);
    expect(mock.getCredentialsByRefugee("ST1REFUGEE")).toEqual([0n]);
  });

  it("rejects issuance by unregistered institution", () => {
    mock.setCaller("ST1FAKE");
    const hash = Buffer.from("hash", "utf8");
    const result = mock.issueCredential(
      "ST1REFUGEE",
      1n,
      CRED_EDUCATION,
      undefined,
      hash,
      "Degree"
    );
    expect(result.isOk).toBe(false);
    expect(result.value).toBe(BigInt(ERR_INSTITUTION_NOT_REGISTERED));
  });

  it("prevents duplicate credential per proof", () => {
    mock.setCaller("ST1REG");
    mock.registerInstitution("ST1INST");
    mock.setCaller("ST1INST");

    const hash = Buffer.from("hash", "utf8");
    mock.issueCredential(
      "ST1REFUGEE",
      1n,
      CRED_EDUCATION,
      undefined,
      hash,
      "First"
    );
    const result = mock.issueCredential(
      "ST1REFUGEE",
      1n,
      CRED_COURSE,
      undefined,
      hash,
      "Second"
    );

    expect(result.isOk).toBe(false);
    expect(result.value).toBe(BigInt(ERR_CREDENTIAL_EXISTS));
  });

  it("revokes credential by issuer", () => {
    mock.setCaller("ST1REG");
    mock.registerInstitution("ST1INST");
    mock.setCaller("ST1INST");

    const hash = Buffer.from("hash", "utf8");
    mock.issueCredential(
      "ST1REFUGEE",
      1n,
      CRED_EDUCATION,
      undefined,
      hash,
      "Degree"
    );
    const revoke = mock.revokeCredential(0n);

    expect(revoke.isOk).toBe(true);
    expect(mock.isCredentialValid(0n)).toBe(false);
  });

  it("verifies valid credential", () => {
    mock.setCaller("ST1REG");
    mock.registerInstitution("ST1INST");
    mock.setCaller("ST1INST");

    const hash = Buffer.from("hash", "utf8");
    mock.issueCredential(
      "ST1REFUGEE",
      1n,
      CRED_EDUCATION,
      undefined,
      hash,
      "Degree"
    );
    const verify = mock.verifyCredential(0n, "ST1REFUGEE");

    expect(verify.isOk).toBe(true);
    expect(verify.value).toBe(true);
  });

  it("expires credential after block height", () => {
    mock.setCaller("ST1REG");
    mock.registerInstitution("ST1INST");
    mock.setCaller("ST1INST");

    const hash = Buffer.from("hash", "utf8");
    mock.issueCredential("ST1REFUGEE", 1n, CRED_EDUCATION, 10n, hash, "Degree");
    mock.setBlockHeight(2011n);

    expect(mock.isCredentialValid(0n)).toBe(false);
  });

  it("limits refugee credentials to 50", () => {
    mock.setCaller("ST1REG");
    mock.registerInstitution("ST1INST");
    mock.setCaller("ST1INST");

    const hash = Buffer.from("hash", "utf8");
    for (let i = 0; i < 50; i++) {
      mock.issueCredential(
        "ST1REFUGEE",
        BigInt(i + 100),
        CRED_COURSE,
        undefined,
        hash,
        `Course ${i}`
      );
    }
    const result = mock.issueCredential(
      "ST1REFUGEE",
      150n,
      CRED_COURSE,
      undefined,
      hash,
      "Overflow"
    );
    expect(result.isOk).toBe(false);
  });

  it("rejects invalid proof ownership", () => {
    mock.setCaller("ST1REG");
    mock.registerInstitution("ST1INST");
    mock.setCaller("ST1INST");

    const hash = Buffer.from("hash", "utf8");
    const result = mock.issueCredential(
      "ST1WRONG",
      1n,
      CRED_EDUCATION,
      undefined,
      hash,
      "Degree"
    );
    expect(result.isOk).toBe(false);
    expect(result.value).toBe(BigInt(ERR_REFUGEE_NOT_OWNER));
  });
});
