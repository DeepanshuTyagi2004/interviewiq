import { ApiFetchError } from "@/lib/api-client/client";

export function linkedInError(error: unknown): string {
  if (error instanceof ApiFetchError) {
    if (error.status === 401) return "Your session expired. Sign in again, then upload the PDF again.";
    if (error.code === "linkedin_import_busy") return "Another LinkedIn action is still in progress. Wait a moment, then try again.";
    if (error.code === "linkedin_import_cancelled") return "This import was cancelled because LinkedIn was disconnected. Upload the PDF again.";
    if (error.code === "linkedin_import_disabled") return "LinkedIn import is turned off right now. Add your career details on your profile instead.";
    if (error.code === "linkedin_pdf_unrecognized") return "This doesn't look like LinkedIn's Save to PDF file. Follow the steps above and upload that file. Your resume goes in the Resume row.";
    if (error.code === "linkedin_pdf_unreadable") return "We couldn't read text from this PDF. Download it again with LinkedIn's Save to PDF and upload that file.";
    if (error.code === "linkedin_pdf_no_claims") return "No career details could be read from this PDF. Check it's LinkedIn's Save to PDF file, or add details on your profile.";
    if (error.code === "linkedin_draft_limit") return "You have three unconfirmed imports. Confirm one, remove LinkedIn, or wait 24 hours for them to expire.";
    if (error.status === 409) return "Your profile changed during review. Upload the PDF again to preview against your latest profile.";
    if (error.status === 410 || error.status === 404) return "This draft expired or is unavailable. Upload the PDF again.";
    if (error.status === 413) return "The PDF must be 5 MB or smaller. LinkedIn's Save to PDF file is usually well under 1 MB.";
    if (error.status === 415) return "Upload the PDF file from LinkedIn's Save to PDF.";
    if (error.status === 400) return "Choose your LinkedIn PDF and confirm the consent checkbox.";
    if (error.status === 422) return "Usable career details couldn't be read from this PDF. Check it's LinkedIn's Save to PDF file.";
    if (error.status === 502 || error.status === 503 || error.status === 504) return "Couldn't read it right now. Try again in a minute.";
    if (error.status === 429) return "Too many imports. Wait a moment, then try again.";
  }
  return "Could not complete the request. Check your LinkedIn status before trying again.";
}
