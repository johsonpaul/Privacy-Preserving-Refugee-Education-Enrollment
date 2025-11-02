;; ZKProofManager.clar
(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-PROOF-EXISTS u101)
(define-constant ERR-PROOF-NOT-FOUND u102)
(define-constant ERR-INVALID-PROOF-TYPE u103)
(define-constant ERR-INVALID-HASH u104)
(define-constant ERR-VERIFIER-NOT-REGISTERED u105)
(define-constant ERR-PROOF-REVOKED u106)
(define-constant ERR-INVALID-EXPIRY u107)
(define-constant ERR-PROOF-EXPIRED u108)

(define-constant PROOF-TYPE-EDUCATION u1)
(define-constant PROOF-TYPE-IDENTITY u2)
(define-constant PROOF-TYPE-SKILL u3)

(define-data-var next-proof-id uint u0)
(define-data-var admin principal tx-sender)

(define-map registered-verifiers principal bool)
(define-map proof-metadata
  uint
  {
    owner: principal,
    proof-hash: (buff 32),
    proof-type: uint,
    issued-at: uint,
    expires-at: (optional uint),
    revoked: bool,
    verifier: principal
  }
)

(define-map user-proofs principal (list 100 uint))
(define-map proof-hash-index (buff 32) uint)

(define-read-only (get-proof (proof-id uint))
  (map-get? proof-metadata proof-id)
)

(define-read-only (get-user-proofs (user principal))
  (default-to (list) (map-get? user-proofs user))
)

(define-read-only (is-verifier (verifier principal))
  (default-to false (map-get? registered-verifiers verifier))
)

(define-read-only (validate-proof-hash (proof-id uint) (claimed-hash (buff 32)))
  (match (map-get? proof-metadata proof-id)
    proof (and (is-eq (get proof-hash proof) claimed-hash) (not (get revoked proof)))
    false
  )
)

(define-read-only (is-proof-valid (proof-id uint))
  (match (map-get? proof-metadata proof-id)
    proof
      (let ((expired (match (get expires-at proof)
                        exp (>= block-height exp)
                        false)))
        (and (not (get revoked proof)) (not expired)))
    false
  )
)

(define-private (valid-proof-type (ptype uint))
  (or (is-eq ptype PROOF-TYPE-EDUCATION)
      (is-eq ptype PROOF-TYPE-IDENTITY)
      (is-eq ptype PROOF-TYPE-SKILL))
)

(define-public (register-verifier (verifier principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-UNAUTHORIZED))
    (map-set registered-verifiers verifier true)
    (ok true)
  )
)

(define-public (issue-zk-proof
  (owner principal)
  (proof-hash (buff 32))
  (proof-type uint)
  (expires-in-blocks (optional uint))
)
  (let ((proof-id (var-get next-proof-id))
        (verifier tx-sender)
        (expires-at (match expires-in-blocks
                       blocks (+ block-height blocks)
                       none)))
    (asserts! (is-verifier verifier) (err ERR-VERIFIER-NOT-REGISTERED))
    (asserts! (valid-proof-type proof-type) (err ERR-INVALID-PROOF-TYPE))
    (asserts! (> (len proof-hash) u0) (err ERR-INVALID-HASH))
    (asserts! (is-none (map-get? proof-hash-index proof-hash)) (err ERR-PROOF-EXISTS))
    (map-set proof-metadata proof-id
      {
        owner: owner,
        proof-hash: proof-hash,
        proof-type: proof-type,
        issued-at: block-height,
        expires-at: expires-at,
        revoked: false,
        verifier: verifier
      }
    )
    (map-set proof-hash-index proof-hash proof-id)
    (map-set user-proofs owner
      (unwrap! (as-max-len? (append (get-user-proofs owner) proof-id) u100) (err ERR-UNAUTHORIZED))
    )
    (var-set next-proof-id (+ proof-id u1))
    (ok proof-id)
  )
)

(define-public (revoke-proof (proof-id uint))
  (match (map-get? proof-metadata proof-id)
    proof
      (begin
        (asserts! (or (is-eq tx-sender (get verifier proof)) (is-eq tx-sender (var-get admin))) (err ERR-UNAUTHORIZED))
        (map-set proof-metadata proof-id
          (merge proof { revoked: true })
        )
        (ok true)
      )
    (err ERR-PROOF-NOT-FOUND)
  )
)

(define-public (verify-proof-ownership (proof-id uint) (claimed-owner principal))
  (match (map-get? proof-metadata proof-id)
    proof
      (if (and (is-eq (get owner proof) claimed-owner) (is-proof-valid proof-id))
          (ok true)
          (err ERR-UNAUTHORIZED))
    (err ERR-PROOF-NOT-FOUND)
  )
)

(define-public (transfer-admin (new-admin principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-UNAUTHORIZED))
    (var-set admin new-admin)
    (ok true)
  )
)