# 🌍 Privacy-Preserving Refugee Education Enrollment

Welcome to a groundbreaking Web3 solution for refugees facing barriers in accessing education due to lost documents, border restrictions, and privacy concerns! This project uses the Stacks blockchain and Clarity smart contracts to create a decentralized, privacy-focused system for enrolling in educational programs and maintaining verifiable education histories. Refugees can prove their qualifications without revealing sensitive personal details, enabling seamless cross-border opportunities.

## ✨ Features
🔒 Privacy-first credential issuance using zero-knowledge proofs  
📜 Verifiable education histories that work across borders  
🏫 Easy enrollment for refugees in global institutions  
✅ Instant verification by employers or schools without full data exposure  
🚫 Secure prevention of fraudulent claims or duplicates  
🌐 Decentralized storage of encrypted transcripts  
🤝 Collaboration tools for institutions and NGOs  
💰 Incentive mechanisms for participating verifiers and issuers  

## 🛠 How It Works
This system leverages 8 Clarity smart contracts to handle registration, issuance, verification, and privacy. It solves the real-world problem of refugees lacking verifiable education records by allowing secure, anonymous proof of qualifications—empowering them to continue studies or find jobs worldwide.

### Smart Contracts Overview
1. **UserRegistry.clar**: Registers refugees anonymously with a unique ID and zero-knowledge proof of identity (no personal data stored on-chain).  
2. **InstitutionRegistry.clar**: Onboards educational institutions and NGOs, verifying their legitimacy via multisig approvals.  
3. **CredentialIssuer.clar**: Allows institutions to issue digital credentials (e.g., diplomas, course completions) as NFTs with embedded hashes.  
4. **ZKProofManager.clar**: Handles zero-knowledge proofs for privacy-preserving verifications, ensuring claims like "I completed this degree" without revealing details.  
5. **EnrollmentHandler.clar**: Manages refugee enrollments in courses, checking prerequisites via verified credentials.  
6. **TranscriptVault.clar**: Stores encrypted education histories off-chain with on-chain hashes for integrity.  
7. **VerificationGateway.clar**: Enables third parties (e.g., employers) to verify credentials without accessing full data.  
8. **DisputeResolver.clar**: Facilitates resolution of claims disputes through decentralized arbitration with staked tokens.

**For Refugees**  
- Register anonymously via UserRegistry with a ZK proof of basic eligibility.  
- Enroll in programs using EnrollmentHandler, proving prior education via CredentialVerifier.  
- Receive credentials from CredentialIssuer after completion—stored securely in TranscriptVault.  
Boom! Your education history is now verifiable anywhere without borders or paperwork.

**For Educational Institutions**  
- Register via InstitutionRegistry to gain issuing rights.  
- Use CredentialIssuer to award verifiable diplomas or certificates.  
- Verify incoming students' histories with VerificationGateway for seamless enrollment.

**For Verifiers (Employers/NGOs)**  
- Call VerificationGateway with a credential hash to confirm authenticity.  
- Use ZKProofManager for privacy-respecting queries like "Does this person have a bachelor's degree?"  
That's it! Quick, secure checks without exposing refugee data.