;; CredentialIssuer.clar
(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-PROOF-NOT-FOUND u101)
(define-constant ERR-PROOF-INVALID u102)
(define-constant ERR-INSTITUTION-NOT-REGISTERED u103)
(define-constant ERR-CREDENTIAL-EXISTS u104)
(define-constant ERR-INVALID-CREDENTIAL-TYPE u105)
(define-constant ERR-REFUGEE-NOT-OWNER u106)
(define-constant ERR-CREDENTIAL-REVOKED u107)
(define-constant ERR-EXPIRY-PAST u108)

(define-constant CRED-EDUCATION u1)
(define-constant CRED-CERTIFICATION u2)
(define-constant CRED-COURSE u3)

(define-data-var zk-proof-contract principal tx-sender)
(define-data-var institution-registry principal tx-sender)
(define-data-var next-credential-id uint u0)

(define-map registered-institutions principal bool)

(define-map credentials
  uint
  {
    refugee: principal,
    institution: principal,
    credential-type: uint,
    proof-id: uint,
    issued-at: uint,
    expires-at: (optional uint),
    revoked: bool,
    metadata-hash: (buff 32),
    title: (string-utf8 100),
    description: (string-utf8 300)
  }
)

(define-map credential-by-proof uint uint)
(define-map refugee-credentials principal (list 50 uint))

(define-read-only (get-credential (cred-id uint))
  (map-get? credentials cred-id)
)

(define-read-only (get-credentials-by-refugee (refugee principal))
  (default-to (list) (map-get? refugee-credentials refugee))
)

(define-read-only (is-institution (inst principal))
  (default-to false (map-get? registered-institutions inst))
)

(define-read-only (is-credential-valid (cred-id uint))
  (match (map-get? credentials cred-id)
    cred
      (let ((expired (match (get expires-at cred)
                        exp (>= block-height exp)
                        false)))
        (and (not (get revoked cred)) (not expired)))
    false
  )
)

(define-private (valid-cred-type (ctype uint))
  (or (is-eq ctype CRED-EDUCATION)
      (is-eq ctype CRED-CERTIFICATION)
      (is-eq ctype CRED-COURSE))
)

(define-private (call-zk-proof (func (string-ascii 50)) (args (list 10 clarity-value)))
  (contract-call? (var-get zk-proof-contract) func args)
)

(define-public (set-zk-proof-contract (contract principal))
  (begin
    (asserts! (is-eq tx-sender (var-get institution-registry)) (err ERR-UNAUTHORIZED))
    (var-set zk-proof-contract contract)
    (ok true)
  )
)

(define-public (register-institution (inst principal))
  (begin
    (asserts! (is-eq tx-sender (var-get institution-registry)) (err ERR-UNAUTHORIZED))
    (map-set registered-institutions inst true)
    (ok true)
  )
)

(define-public (issue-credential
  (refugee principal)
  (proof-id uint)
  (cred-type uint)
  (expires-in-blocks (optional uint))
  (metadata-hash (buff 32))
  (title (string-utf8 100))
  (description (string-utf8 300))
)
  (let ((cred-id (var-get next-credential-id))
        (issuer tx-sender)
        (expires-at (match expires-in-blocks
                       blocks (+ block-height blocks)
                       none)))
    (asserts! (is-institution issuer) (err ERR-INSTITUTION-NOT-REGISTERED))
    (asserts! (valid-cred-type cred-type) (err ERR-INVALID-CREDENTIAL-TYPE))
    (asserts! (> (len metadata-hash) u0) (err ERR-UNAUTHORIZED))
    (asserts! (> (len title) u0) (err ERR-UNAUTHORIZED))
    (try! (call-zk-proof "verify-proof-ownership" (list (uint-cv proof-id) (principal-cv refugee))))
    (asserts! (is-eq (try! (call-zk-proof "is-proof-valid" (list (uint-cv proof-id)))) true) (err ERR-PROOF-INVALID))
    (asserts! (is-none (map-get? credential-by-proof proof-id)) (err ERR-CREDENTIAL-EXISTS))
    (map-set credentials cred-id
      {
        refugee: refugee,
        institution: issuer,
        credential-type: cred-type,
        proof-id: proof-id,
        issued-at: block-height,
        expires-at: expires-at,
        revoked: false,
        metadata-hash: metadata-hash,
        title: title,
        description: description
      }
    )
    (map-set credential-by-proof proof-id cred-id)
    (map-set refugee-credentials refugee
      (unwrap! (as-max-len? (append (get-credentials-by-refugee refugee) cred-id) u50) (err ERR-UNAUTHORIZED))
    )
    (var-set next-credential-id (+ cred-id u1))
    (ok cred-id)
  )
)

(define-public (revoke-credential (cred-id uint))
  (match (map-get? credentials cred-id)
    cred
      (begin
        (asserts! (or (is-eq tx-sender (get institution cred)) (is-eq tx-sender (var-get institution-registry))) (err ERR-UNAUTHORIZED))
        (map-set credentials cred-id
          (merge cred { revoked: true })
        )
        (ok true)
      )
    (err ERR-PROOF-NOT-FOUND)
  )
)

(define-public (verify-credential (cred-id uint) (refugee principal))
  (match (map-get? credentials cred-id)
    cred
      (if (and (is-eq (get refugee cred) refugee) (is-credential-valid cred-id))
          (ok true)
          (err ERR-PROOF-INVALID))
    (err ERR-PROOF-NOT-FOUND)
  )
)