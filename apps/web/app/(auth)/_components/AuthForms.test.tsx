import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiFetchError } from "@/lib/api-client/errors";

const auth = vi.hoisted(() => ({ signUp: vi.fn(), signIn: vi.fn(), login: vi.fn(), status: "unauthenticated" }));
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

vi.mock("@/lib/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams("email=asha%40example.com"),
}));

import { SignInForm } from "./SignInForm";
import { SignUpForm } from "./SignUpForm";

describe("SignUpForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prefills ?email= and continues to onboarding on success", async () => {
    const user = userEvent.setup();
    auth.signUp.mockResolvedValueOnce(undefined);
    render(<SignUpForm />);
    expect(screen.getByLabelText("Email")).toHaveValue("asha@example.com");

    await user.type(screen.getByLabelText("Full name"), "Asha Rao");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(auth.signUp).toHaveBeenCalledWith({ name: "Asha Rao", email: "asha@example.com", password: "correct horse" });
    expect(router.replace).toHaveBeenCalledWith("/onboarding");
  });

  it("shows a taken email next to the email field", async () => {
    const user = userEvent.setup();
    auth.signUp.mockRejectedValueOnce(new ApiFetchError(409, "email_taken", "taken"));
    render(<SignUpForm />);
    await user.type(screen.getByLabelText("Full name"), "Asha Rao");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("validates before calling the API", async () => {
    const user = userEvent.setup();
    render(<SignUpForm />);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Enter your name.")).toBeInTheDocument();
    expect(auth.signUp).not.toHaveBeenCalled();
  });
});

describe("SignInForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the generic credentials error", async () => {
    const user = userEvent.setup();
    auth.signIn.mockRejectedValueOnce(new ApiFetchError(401, "invalid_credentials", "x"));
    render(<SignInForm />);
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
  });
});
