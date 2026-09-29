package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.dtos.ApiError;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

/**
 * Multipart size limits are enforced by the servlet container during (eager) multipart parsing —
 * BEFORE the target handler is resolved — so a {@link MaxUploadSizeExceededException} can be thrown
 * with a null handler and would never reach a controller-local {@code @ExceptionHandler}. Handling
 * it here, globally, guarantees an oversized upload returns the clean 413 {@link ApiError} the
 * frontend keys on (this also covers the résumé controller's own explicit 6 MB check).
 */
@RestControllerAdvice
public class UploadExceptionAdvice {

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ApiError> handleTooLarge(MaxUploadSizeExceededException ex) {
        return ResponseEntity.status(413)
                .body(new ApiError("resume_too_large", "The résumé must be 6 MB or smaller."));
    }
}
