package com.interviewiq.interviewiq_backend.integrations.github;

/**
 * Documentation of the GraphQL response shape we depend on. We deliberately
 * parse with JsonNode in GitHubCollector (resilient to extra/missing fields),
 * so this type carries no logic; it records the contract for future readers.
 *
 * data.viewer {
 *   login, name, avatarUrl, createdAt,
 *   repositories { totalCount, nodes[]{ name, stargazerCount, pushedAt, isFork,
 *       primaryLanguage{name}, languages{ edges[]{ size, node{name} } } } },
 *   contributionsCollection {
 *     contributionCalendar { totalContributions, weeks[]{ contributionDays[]{ contributionCount } } },
 *     pullRequestContributionsByRepository[]{ repository{ owner{login} }, contributions{ totalCount } }
 *   }
 * }
 */
public final class GitHubGraphQlResponse {
    private GitHubGraphQlResponse() {
    }
}
