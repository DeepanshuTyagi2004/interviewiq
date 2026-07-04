package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.dtos.ApiError;
import com.interviewiq.interviewiq_backend.dtos.UpdateRoleRequest;
import com.interviewiq.interviewiq_backend.dtos.UserResponse;
import com.interviewiq.interviewiq_backend.models.Role;
import com.interviewiq.interviewiq_backend.models.User;
import com.interviewiq.interviewiq_backend.services.UserService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Admin user management — list users and promote/demote their role. ADMIN-only
 * (enforced in SecurityConfig for {@code /api/v1/admin/**}). This is how an admin
 * grants another user access to the intelligence console.
 */
@RestController
@RequestMapping(value = "/api/{version}/admin/users", version = "1")
public class AdminUserController {

    private final UserService userService;

    public AdminUserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping
    public List<UserResponse> listUsers() {
        return userService.listUsers().stream().map(AdminUserController::toResponse).toList();
    }

    @PatchMapping("/{id}/role")
    public ResponseEntity<?> updateRole(@PathVariable UUID id, @RequestBody UpdateRoleRequest request) {
        Role role;
        try {
            role = Role.valueOf(request.role().trim().toUpperCase());
        } catch (IllegalArgumentException | NullPointerException ex) {
            return ResponseEntity.badRequest()
                    .body(new ApiError("invalid_role", "role must be USER or ADMIN"));
        }
        return userService.updateRole(id, role)
                .<ResponseEntity<?>>map(user -> ResponseEntity.ok(toResponse(user)))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(new ApiError("user_not_found", "no user with that id")));
    }

    private static UserResponse toResponse(User user) {
        return new UserResponse(
                user.getId().toString(), user.getEmail(), user.getName(), user.getRole().name(),
                user.isOnboardingComplete());
    }
}
