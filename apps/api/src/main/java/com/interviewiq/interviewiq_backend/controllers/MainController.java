package com.interviewiq.interviewiq_backend.controllers;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/{version}/main", version = "1")
public class MainController {
    @GetMapping(value = "/healthcheck")
    public ResponseEntity<String> healthCheck() {
        return new ResponseEntity<>("Server Up", HttpStatus.OK);
    }
}
