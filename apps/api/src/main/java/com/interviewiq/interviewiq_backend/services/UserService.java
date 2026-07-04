package com.interviewiq.interviewiq_backend.services;

import com.interviewiq.interviewiq_backend.models.Role;
import com.interviewiq.interviewiq_backend.models.User;
import com.interviewiq.interviewiq_backend.repositories.UserRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class UserService {
    private final UserRepository userRepository;
    /** Emails promoted to ADMIN on login — the bootstrap for the very first admins. */
    private final Set<String> bootstrapAdminEmails;

    public UserService(
            UserRepository userRepository,
            @Value("${app.admin-emails:}") String adminEmailsCsv) {
        this.userRepository = userRepository;
        this.bootstrapAdminEmails = Arrays.stream(adminEmailsCsv.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .map(s -> s.toLowerCase())
                .collect(Collectors.toUnmodifiableSet());
    }

    @Transactional
    public User upsertUser(OAuth2User oAuth2User) {
        String googleSub = oAuth2User.getAttribute("sub");
        String email = oAuth2User.getAttribute("email");
        String name = oAuth2User.getAttribute("name");

        User user = userRepository.findByGoogleSub(googleSub)
                .map(existingUser -> {
                    existingUser.setEmail(email);
                    existingUser.setName(name);
                    return existingUser;
                })
                .orElseGet(() -> new User(googleSub, email, name));

        // Bootstrap promote (never auto-demote — demotion is an explicit admin action).
        if (isBootstrapAdmin(email) && user.getRole() != Role.ADMIN) {
            user.setRole(Role.ADMIN);
        }

        return userRepository.save(user);
    }

    public Optional<User> getById(UUID id) {
        return userRepository.findById(id);
    }

    public List<User> listUsers() {
        return userRepository.findAll();
    }

    @Transactional
    public Optional<User> updateRole(UUID id, Role role) {
        return userRepository.findById(id).map(user -> {
            user.setRole(role);
            return userRepository.save(user);
        });
    }

    private boolean isBootstrapAdmin(String email) {
        return email != null && bootstrapAdminEmails.contains(email.toLowerCase());
    }
}
