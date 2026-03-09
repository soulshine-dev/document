export type DiplomaStatus = "valid" | "revoked";
export type DocumentType = "Diploma" | "Transcript";
export type DeliveryMode = "Traditional Education" | "Webinar";

export type DiplomaRecord = {
  diplomaId: string;
  documentType: DocumentType;
  holderName: string;
  studentNumber: string;
  degree: string;
  program: string;
  faculty: string;
  issuedOn: string;
  deliveryMode: DeliveryMode;
  status: DiplomaStatus;
  revokedReason?: string;
};
