;; EnrollmentHandler.clar
(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-CREDENTIAL-NOT-FOUND u101)
(define-constant ERR-CREDENTIAL-INVALID u102)
(define-constant ERR-INSTITUTION-NOT-REGISTERED u103)
(define-constant ERR-ENROLLMENT-EXISTS u104)
(define-constant ERR-PREREQ-NOT-MET u105)
(define-constant ERR-COURSE-NOT-FOUND u106)
(define-constant ERR-COURSE-CLOSED u107)
(define-constant ERR-MAX-ENROLLMENTS u108)
(define-constant ERR-ALREADY-ENROLLED u109)

(define-data-var credential-issuer principal tx-sender)
(define-data-var institution-registry principal tx-sender)
(define-data-var next-enrollment-id uint u0)

(define-map courses
  uint
  {
    institution: principal,
    title: (string-utf8 100),
    description: (string-utf8 300),
    capacity: uint,
    enrolled-count: uint,
    open: bool,
    prereq-cred-type: (optional uint),
    start-block: uint,
    end-block: uint
  }
)

(define-map enrollments
  uint
  {
    refugee: principal,
    course-id: uint,
    credential-id: (optional uint),
    enrolled-at: uint,
    status: (string-ascii 20)
  }
)

(define-map course-enrollments uint (list 200 uint))
(define-map refugee-enrollments principal (list 50 uint))

(define-read-only (get-course (course-id uint))
  (map-get? courses course-id)
)

(define-read-only (get-enrollment (enroll-id uint))
  (map-get? enrollments enroll-id)
)

(define-read-only (get-enrollments-by-course (course-id uint))
  (default-to (list) (map-get? course-enrollments course-id))
)

(define-read-only (get-enrollments-by-refugee (refugee principal))
  (default-to (list) (map-get? refugee-enrollments refugee))
)

(define-read-only (is-course-open (course-id uint))
  (match (map-get? courses course-id)
    course (and (get open course) (< (get enrolled-count course) (get capacity course)))
    false
  )
)

(define-private (call-cred-issuer (func (string-ascii 50)) (args (list 10 clarity-value)))
  (contract-call? (var-get credential-issuer) func args)
)

(define-private (call-inst-reg (func (string-ascii 50)) (args (list 10 clarity-value)))
  (contract-call? (var-get institution-registry) func args)
)

(define-public (set-credential-issuer (contract principal))
  (begin
    (asserts! (is-eq tx-sender (var-get institution-registry)) (err ERR-UNAUTHORIZED))
    (var-set credential-issuer contract)
    (ok true)
  )
)

(define-public (create-course
  (title (string-utf8 100))
  (description (string-utf8 300))
  (capacity uint)
  (prereq-cred-type (optional uint))
  (duration-blocks uint)
)
  (let ((course-id (var-get next-enrollment-id))
        (issuer tx-sender)
        (start (+ block-height u1))
        (end (+ block-height duration-blocks)))
    (asserts! (try! (call-inst-reg "is-institution" (list (principal-cv issuer)))) (err ERR-INSTITUTION-NOT-REGISTERED))
    (asserts! (> capacity u0) (err ERR-UNAUTHORIZED))
    (asserts! (> duration-blocks u0) (err ERR-UNAUTHORIZED))
    (asserts! (> (len title) u0) (err ERR-UNAUTHORIZED))
    (map-set courses course-id
      {
        institution: issuer,
        title: title,
        description: description,
        capacity: capacity,
        enrolled-count: u0,
        open: true,
        prereq-cred-type: prereq-cred-type,
        start-block: start,
        end-block: end
      }
    )
    (var-set next-enrollment-id (+ course-id u1))
    (ok course-id)
  )
)

(define-public (close-course (course-id uint))
  (match (map-get? courses course-id)
    course
      (begin
        (asserts! (is-eq tx-sender (get institution course)) (err ERR-UNAUTHORIZED))
        (map-set courses course-id
          (merge course { open: false })
        )
        (ok true)
      )
    (err ERR-COURSE-NOT-FOUND)
  )
)

(define-public (enroll-in-course
  (course-id uint)
  (prereq-cred-id (optional uint))
)
  (let ((enroll-id (var-get next-enrollment-id))
        (refugee tx-sender))
    (let ((course (unwrap! (map-get? courses course-id) (err ERR-COURSE-NOT-FOUND))))
      (asserts! (get open course) (err ERR-COURSE-CLOSED))
      (asserts! (< (get enrolled-count course) (get capacity course)) (err ERR-MAX-ENROLLMENTS))
      (asserts! (not (is-some (some enroll-id))) (err ERR-ALREADY-ENROLLED))
      (match (get prereq-cred-type course)
        req-type
          (let ((cred-id (unwrap! prereq-cred-id (err ERR-PREREQ-NOT-MET))))
            (asserts! (is-eq (try! (call-cred-issuer "verify-credential" (list (uint-cv cred-id) (principal-cv refugee)))) true) (err ERR-PREREQ-NOT-MET))
            (try! (enroll-with-cred enroll-id course-id cred-id course))
          )
        (try! (enroll-with-cred enroll-id course-id none course))
      )
    )
  )
)

(define-private (enroll-with-cred
  (enroll-id uint)
  (course-id uint)
  (cred-id (optional uint))
  (course {
    institution: principal,
    title: (string-utf8 100),
    description: (string-utf8 300),
    capacity: uint,
    enrolled-count: uint,
    open: bool,
    prereq-cred-type: (optional uint),
    start-block: uint,
    end-block: uint
  })
)
  (begin
    (map-set enrollments enroll-id
      {
        refugee: tx-sender,
        course-id: course-id,
        credential-id: cred-id,
        enrolled-at: block-height,
        status: "active"
      }
    )
    (map-set course-enrollments course-id
      (unwrap! (as-max-len? (append (get-enrollments-by-course course-id) enroll-id) u200) (err ERR-UNAUTHORIZED))
    )
    (map-set refugee-enrollments tx-sender
      (unwrap! (as-max-len? (append (get-enrollments-by-refugee tx-sender) enroll-id) u50) (err ERR-UNAUTHORIZED))
    )
    (map-set courses course-id
      (merge course { enrolled-count: (+ (get enrolled-count course) u1) })
    )
    (var-set next-enrollment-id (+ enroll-id u1))
    (ok enroll-id)
  )
)

(define-public (cancel-enrollment (enroll-id uint))
  (match (map-get? enrollments enroll-id)
    enroll
      (let ((course-id (get course-id enroll))
            (course (unwrap! (map-get? courses course-id) (err ERR-COURSE-NOT-FOUND))))
        (asserts! (or (is-eq tx-sender (get refugee enroll)) (is-eq tx-sender (get institution course))) (err ERR-UNAUTHORIZED))
        (asserts! (>= block-height (get start-block course)) (err ERR-UNAUTHORIZED))
        (map-set enrollments enroll-id
          (merge enroll { status: "cancelled" })
        )
        (map-set courses course-id
          (merge course { enrolled-count: (- (get enrolled-count course) u1) })
        )
        (ok true)
      )
    (err ERR-CREDENTIAL-NOT-FOUND)
  )
)