package com.interviewiq.interviewiq_backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
@EnableAsync
public class InterviewiqBackendApplication {

	public static void main(String[] args) {
		SpringApplication.run(InterviewiqBackendApplication.class, args);
	}

}
