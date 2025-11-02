// tests/EnrollmentHandler.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { Cl, uintCV, someCV, noneCV, principalCV } from "@stacks/transactions";

const ERR_UNAUTHORIZED = 100;
const ERR_CREDENTIAL_NOT_FOUND = 101;
const ERR_CREDENTIAL_INVALID = 102;
const ERR_INSTITUTION_NOT_REGISTERED = 103;
const ERR_ENROLLMENT_EXISTS = 104;
const ERR_PREREQ_NOT_MET = 105;
const ERR_COURSE_NOT_FOUND = 106;
const ERR_COURSE_CLOSED = 107;
const ERR_MAX_ENROLLMENTS = 108;
const ERR_ALREADY_ENROLLED = 109;

interface Course {
  institution: string;
  title: string;
  description: string;
  capacity: bigint;
  enrolledCount: bigint;
  open: boolean;
  prereqCredType?: bigint | null;
  startBlock: bigint;
  endBlock: bigint;
}

interface Enrollment {
  refugee: string;
  courseId: bigint;
  credentialId?: bigint | null;
  enrolledAt: bigint;
  status: string;
}

interface Result<T> {
  isOk: boolean;
  value: T;
}

class CredentialIssuerMock {
  verifyCredential(credId: bigint, refugee: string): Result<boolean> {
    if (credId === 999n) return { isOk: false, value: false };
    return { isOk: true, value: refugee === "ST1REFUGEE" };
  }
}

class InstitutionRegistryMock {
  isInstitution(inst: string): Result<boolean> {
    return { isOk: true, value: inst === "ST1INST" };
  }
}

class EnrollmentHandlerMock {
  state = {
    credentialIssuer: "ST1CRED",
    institutionRegistry: "ST1REG",
    nextEnrollmentId: 0n,
    courses: new Map<bigint, Course>(),
    enrollments: new Map<bigint, Enrollment>(),
    courseEnrollments: new Map<bigint, bigint[]>(),
    refugeeEnrollments: new Map<string, bigint[]>(),
  };
  blockHeight = 3000n;
  caller = "ST1INST";
  credIssuer = new CredentialIssuerMock();
  instReg = new InstitutionRegistryMock();

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      credentialIssuer: "ST1CRED",
      institutionRegistry: "ST1REG",
      nextEnrollmentId: 0n,
      courses: new Map(),
      enrollments: new Map(),
      courseEnrollments: new Map(),
      refugeeEnrollments: new Map(),
    };
    this.blockHeight = 3000n;
    this.caller = "ST1INST";
  }

  setCaller(caller: string) {
    this.caller = caller;
  }

  setBlockHeight(height: bigint) {
    this.blockHeight = height;
  }

  setCredentialIssuer(contract: string): Result<boolean> {
    if (this.caller !== this.state.institutionRegistry)
      return { isOk: false, value: false };
    this.state.credentialIssuer = contract;
    return { isOk: true, value: true };
  }

  createCourse(
    title: string,
    description: string,
    capacity: number,
    prereqCredType?: number,
    durationBlocks: number = 100
  ): Result<bigint> {
    const instCheck = this.instReg.isInstitution(this.caller);
    if (!instCheck.isOk || !instCheck.value)
      return { isOk: false, value: BigInt(ERR_INSTITUTION_NOT_REGISTERED) };
    if (capacity <= 0 || durationBlocks <= 0 || title.length === 0)
      return { isOk: false, value: BigInt(ERR_UNAUTHORIZED) };

    const courseId = this.state.nextEnrollmentId;
    const start = this.blockHeight + 1n;
    const end = this.blockHeight + BigInt(durationBlocks);

    const course: Course = {
      institution: this.caller,
      title,
      description,
      capacity: BigInt(capacity),
      enrolledCount: 0n,
      open: true,
      prereqCredType:
        prereqCredType !== undefined ? BigInt(prereqCredType) : undefined,
      startBlock: start,
      endBlock: end,
    };

    this.state.courses.set(courseId, course);
    this.state.nextEnrollmentId += 1n;
    return { isOk: true, value: courseId };
  }

  getCourse(courseId: bigint): Course | null {
    return this.state.courses.get(courseId) ?? null;
  }

  closeCourse(courseId: bigint): Result<boolean> {
    const course = this.state.courses.get(courseId);
    if (!course) return { isOk: false, value: false };
    if (this.caller !== course.institution)
      return { isOk: false, value: false };
    this.state.courses.set(courseId, { ...course, open: false });
    return { isOk: true, value: true };
  }

  enrollInCourse(courseId: bigint, prereqCredId?: bigint): Result<bigint> {
    const course = this.state.courses.get(courseId);
    if (!course) return { isOk: false, value: BigInt(ERR_COURSE_NOT_FOUND) };
    if (!course.open) return { isOk: false, value: BigInt(ERR_COURSE_CLOSED) };
    if (course.enrolledCount >= course.capacity)
      return { isOk: false, value: BigInt(ERR_MAX_ENROLLMENTS) };

    const refugeeEnrollments =
      this.state.refugeeEnrollments.get(this.caller) || [];
    if (
      refugeeEnrollments.some((id) => {
        const e = this.state.enrollments.get(id);
        return e?.courseId === courseId;
      })
    )
      return { isOk: false, value: BigInt(ERR_ALREADY_ENROLLED) };

    if (course.prereqCredType !== undefined) {
      if (prereqCredId === undefined)
        return { isOk: false, value: BigInt(ERR_PREREQ_NOT_MET) };
      const credCheck = this.credIssuer.verifyCredential(
        prereqCredId,
        this.caller
      );
      if (!credCheck.isOk || !credCheck.value)
        return { isOk: false, value: BigInt(ERR_PREREQ_NOT_MET) };
    }

    const enrollId = this.state.nextEnrollmentId;
    const enrollment: Enrollment = {
      refugee: this.caller,
      courseId,
      credentialId: prereqCredId ?? undefined,
      enrolledAt: this.blockHeight,
      status: "active",
    };

    this.state.enrollments.set(enrollId, enrollment);

    const courseList = this.state.courseEnrollments.get(courseId) || [];
    if (courseList.length >= 200)
      return { isOk: false, value: BigInt(ERR_UNAUTHORIZED) };
    this.state.courseEnrollments.set(courseId, [...courseList, enrollId]);

    const refugeeList = this.state.refugeeEnrollments.get(this.caller) || [];
    if (refugeeList.length >= 50)
      return { isOk: false, value: BigInt(ERR_UNAUTHORIZED) };
    this.state.refugeeEnrollments.set(this.caller, [...refugeeList, enrollId]);

    this.state.courses.set(courseId, {
      ...course,
      enrolledCount: course.enrolledCount + 1n,
    });
    this.state.nextEnrollmentId += 1n;

    return { isOk: true, value: enrollId };
  }

  getEnrollment(enrollId: bigint): Enrollment | null {
    return this.state.enrollments.get(enrollId) ?? null;
  }

  getEnrollmentsByCourse(courseId: bigint): bigint[] {
    return this.state.courseEnrollments.get(courseId) || [];
  }

  getEnrollmentsByRefugee(refugee: string): bigint[] {
    return this.state.refugeeEnrollments.get(refugee) || [];
  }

  cancelEnrollment(enrollId: bigint): Result<boolean> {
    const enrollment = this.state.enrollments.get(enrollId);
    if (!enrollment) return { isOk: false, value: false };
    const course = this.state.courses.get(enrollment.courseId);
    if (!course) return { isOk: false, value: false };
    if (
      this.caller !== enrollment.refugee &&
      this.caller !== course.institution
    )
      return { isOk: false, value: false };
    if (this.blockHeight >= course.startBlock)
      return { isOk: false, value: false };

    this.state.enrollments.set(enrollId, {
      ...enrollment,
      status: "cancelled",
    });
    this.state.courses.set(enrollment.courseId, {
      ...course,
      enrolledCount: course.enrolledCount - 1n,
    });
    return { isOk: true, value: true };
  }

  isCourseOpen(courseId: bigint): boolean {
    const course = this.state.courses.get(courseId);
    if (!course) return false;
    return course.open && course.enrolledCount < course.capacity;
  }
}

describe("EnrollmentHandler", () => {
  let mock: EnrollmentHandlerMock;

  beforeEach(() => {
    mock = new EnrollmentHandlerMock();
    mock.reset();
  });

  it("creates course successfully", () => {
    const result = mock.createCourse(
      "Math 101",
      "Intro to Algebra",
      50,
      undefined,
      720
    );
    expect(result.isOk).toBe(true);
    expect(result.value).toBe(0n);

    const course = mock.getCourse(0n);
    expect(course?.title).toBe("Math 101");
    expect(course?.capacity).toBe(50n);
    expect(course?.open).toBe(true);
  });

  it("enrolls refugee without prerequisite", () => {
    mock.createCourse("Free Course", "Open to all", 10);
    mock.setCaller("ST1REFUGEE");

    const result = mock.enrollInCourse(0n);
    expect(result.isOk).toBe(true);
    expect(mock.getEnrollmentsByRefugee("ST1REFUGEE")).toEqual([1n]);
    expect(mock.getCourse(0n)?.enrolledCount).toBe(1n);
  });

  it("enforces prerequisite with valid credential", () => {
    mock.createCourse("Advanced Math", "Requires Algebra", 10, 1);
    mock.setCaller("ST1REFUGEE");

    const result = mock.enrollInCourse(0n, 100n);
    expect(result.isOk).toBe(true);
    expect(mock.getEnrollment(1n)?.credentialId).toBe(100n);
  });

  it("rejects enrollment with invalid prerequisite", () => {
    mock.createCourse("Advanced Math", "Requires Algebra", 10, 1);
    mock.setCaller("ST1REFUGEE");

    const result = mock.enrollInCourse(0n, 999n);
    expect(result.isOk).toBe(false);
    expect(result.value).toBe(BigInt(ERR_PREREQ_NOT_MET));
  });

  it("respects course capacity", () => {
    mock.createCourse("Small Class", "Limited seats", 1);
    mock.setCaller("ST1REFUGEE");
    mock.enrollInCourse(0n);
    mock.setCaller("ST1REFUGEE2");

    const result = mock.enrollInCourse(0n);
    expect(result.isOk).toBe(false);
    expect(result.value).toBe(BigInt(ERR_MAX_ENROLLMENTS));
  });

  it("closes course and prevents enrollment", () => {
    mock.createCourse("Temp Course", "Will close", 10);
    mock.closeCourse(0n);
    mock.setCaller("ST1REFUGEE");

    const result = mock.enrollInCourse(0n);
    expect(result.isOk).toBe(false);
    expect(result.value).toBe(BigInt(ERR_COURSE_CLOSED));
  });

  it("cancels enrollment before start", () => {
    mock.createCourse("Cancellable", "Can drop", 10);
    mock.setCaller("ST1REFUGEE");
    mock.enrollInCourse(0n);

    const cancel = mock.cancelEnrollment(1n);
    expect(cancel.isOk).toBe(true);
    expect(mock.getEnrollment(1n)?.status).toBe("cancelled");
    expect(mock.getCourse(0n)?.enrolledCount).toBe(0n);
  });

  it("limits refugee to 50 enrollments", () => {
    for (let i = 0; i < 50; i++) {
      mock.createCourse(`Course ${i}`, "Test", 1);
      mock.setCaller("ST1REFUGEE");
      mock.enrollInCourse(BigInt(i));
    }
    mock.createCourse("Overflow", "Test", 1);
    mock.setCaller("ST1REFUGEE");

    const result = mock.enrollInCourse(50n);
    expect(result.isOk).toBe(false);
  });

  it("prevents double enrollment in same course", () => {
    mock.createCourse("Unique", "One time", 10);
    mock.setCaller("ST1REFUGEE");
    mock.enrollInCourse(0n);

    const result = mock.enrollInCourse(0n);
    expect(result.isOk).toBe(false);
    expect(result.value).toBe(BigInt(ERR_ALREADY_ENROLLED));
  });
});
