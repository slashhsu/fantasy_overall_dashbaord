import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/login-form";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));

describe("private login", () => {
  beforeEach(() => {
    replace.mockReset();
    refresh.mockReset();
    vi.restoreAllMocks();
  });

  it("submits the password and opens the dashboard", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ authenticated: true }), { status: 200 }),
    );
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Dashboard password"), { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Open dashboard" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(fetchMock).toHaveBeenCalledWith("/api/login", expect.objectContaining({ method: "POST" }));
  });

  it("shows an API authentication error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "That password is not correct." }), { status: 401 }),
    );
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Dashboard password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Open dashboard" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not correct");
  });
});
