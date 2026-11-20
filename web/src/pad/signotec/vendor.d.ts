export interface SignotecResponse {
  command: string;
  returnCode: number;
}

interface SearchParams {
  setPadSubset(type: string): void;
}

interface PadParams {
  padIndex: number;
}

interface StartSignatureParams {
  setFieldName(fieldName: string): void;
  setCustomText(customText: string): void;
  setConfirmationText(confirmationText: string): void;
}

interface ImageParams {
  setFileType(fileType: number): void;
  setPenWidth(penWidth: number): void;
}

interface DataParams {
  setRsaScheme(rsaScheme: 'NONE' | 'NO_HASH_OID' | 'PKCS1_V1_5' | 'PSS'): void;
}

export interface SignotecCommons {
  createConnection(
    url: string,
    onopen: (event: Event) => void,
    onclose: (event: CloseEvent) => void,
    onerror: (event: Event) => void,
  ): void;
  destroyConnection(): void;
  handleDisconnect?: (padIndex: number) => void;
}

export interface SignotecDefault {
  Params: {
    searchForPads: new () => SearchParams;
    openPad: new (padIndex: number) => PadParams;
    closePad: new (padIndex: number) => PadParams;
    startSignature: new () => StartSignatureParams;
    getSignatureImage: new () => ImageParams;
    getSignatureData: new () => DataParams;
  };
  FileType: { PNG: 1 };
  searchForPads(params: SearchParams): Promise<SignotecResponse & { foundPads: { index: number }[] }>;
  openPad(params: PadParams): Promise<SignotecResponse & { displayWidth: number; displayHeight: number }>;
  startSignature(params: StartSignatureParams): Promise<SignotecResponse>;
  confirmSignature(): Promise<SignotecResponse & { countedPoints: number }>;
  retrySignature(): Promise<SignotecResponse>;
  cancelSignature(): Promise<SignotecResponse>;
  getSignatureImage(params: ImageParams): Promise<SignotecResponse & { file: string }>;
  getSignatureData(params: DataParams): Promise<SignotecResponse & { signData: string }>;
  closePad(params: PadParams): Promise<SignotecResponse>;
  handleConfirmSignature?: () => void;
  handleRetrySignature?: () => void;
  handleCancelSignature?: () => void;
  handleError?: (errorContext: string, errorCode: number, errorDescription: string) => void;
}

export interface SignotecLibrary {
  commons: SignotecCommons;
  standard: SignotecDefault;
}

declare global {
  interface Window {
    STPadServerLib?: {
      STPadServerLibCommons?: SignotecCommons;
      STPadServerLibDefault?: SignotecDefault;
    };
    STPadServerLibCommons?: SignotecCommons;
    STPadServerLibDefault?: SignotecDefault;
  }
}
