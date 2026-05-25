package com.interviewiq.interviewiq_backend.services;

import com.interviewiq.interviewiq_backend.models.User;
import com.interviewiq.interviewiq_backend.repositories.UserRepository;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

@Service
public class UserService {
    private final UserRepository userRepository;

    public UserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Transactional
    public User upsertUser(OAuth2User oAuth2User) {
        String googleSub = oAuth2User.getAttribute("sub");
        String email = oAuth2User.getAttribute("email");
        String name = oAuth2User.getAttribute("name");

        return userRepository.findByGoogleSub(googleSub)
                .map(existingUser -> {
                    existingUser.setEmail(email);
                    existingUser.setName(name);

                    return userRepository.save(existingUser);
                })
                .orElseGet(() -> {
                    return userRepository.save(
                            new User(googleSub, email, name));
                });
    }

    public Optional<User> getById(UUID id) {
        return userRepository.findById(id);
    }
}
