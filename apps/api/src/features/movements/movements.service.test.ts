import { describe, expect, it, vi } from "vitest";
import { NotFoundError, ValidationFailedError } from "../../infra/errors";
import type { CategoryService } from "../categories/categories.service";
import { MovementService } from "./movements.service";
import type { MovementRepository } from "./movements.repository";

function makeHarness() {
  const repository = {
    updateById: vi.fn(async () => ({
      id: "m1",
      ownerId: "default",
      amount: 100,
      currency: "ARS",
      category: null,
      note: null,
      occurredAt: new Date("2026-09-01T12:00:00.000Z"),
      createdAt: new Date("2026-09-01T12:00:00.000Z"),
      type: "EXPENSE" as const,
    })),
  } as unknown as MovementRepository;
  const categoryService = {
    assertOwnerCategory: vi.fn(async () => undefined),
  } as unknown as CategoryService;
  const service = new MovementService(repository, categoryService);
  return {
    service,
    repository,
    categoryService,
    mockUpdateById: vi.mocked(repository.updateById),
    mockAssertOwnerCategory: vi.mocked(categoryService.assertOwnerCategory),
  };
}

describe("MovementService.updateMovement", () => {
  it("applies a valid patch and returns the updated movement", async () => {
    const { service, repository, mockUpdateById } = makeHarness();

    const result = await service.updateMovement("default", "m1", { note: "cena" });

    expect(mockUpdateById).toHaveBeenCalledWith("m1", "default", { note: "cena" });
    expect(result.id).toBe("m1");
    expect(repository).toBeDefined();
  });

  it("passes category: null through to clear the category without owner validation", async () => {
    const { service, mockUpdateById, mockAssertOwnerCategory } = makeHarness();

    await service.updateMovement("default", "m1", { category: null });

    expect(mockUpdateById).toHaveBeenCalledWith("m1", "default", { category: null });
    expect(mockAssertOwnerCategory).not.toHaveBeenCalled();
  });

  it("validates a string category against the owner's set (D12)", async () => {
    const { service, mockAssertOwnerCategory } = makeHarness();

    await service.updateMovement("default", "m1", { category: "Cafe" });

    expect(mockAssertOwnerCategory).toHaveBeenCalledWith("default", "Cafe");
  });

  it("rejects a category that is not the owner's with 422", async () => {
    const { service, mockAssertOwnerCategory } = makeHarness();
    mockAssertOwnerCategory.mockRejectedValue(new ValidationFailedError("not owner"));

    await expect(service.updateMovement("default", "m1", { category: "Cafe" })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
  });

  it("rejects an empty patch with 422", async () => {
    const { service } = makeHarness();

    await expect(service.updateMovement("default", "m1", {})).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
  });

  it("rejects a non-positive amount with 422", async () => {
    const { service } = makeHarness();

    await expect(service.updateMovement("default", "m1", { amount: 0 })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
  });

  it("rejects a patch containing only excluded fields (type/occurredAt)", async () => {
    const { service } = makeHarness();

    await expect(service.updateMovement("default", "m1", { type: "INCOME" })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
  });

  it("throws NotFound when the movement does not exist", async () => {
    const { service, mockUpdateById } = makeHarness();
    mockUpdateById.mockResolvedValue(null);

    await expect(service.updateMovement("default", "m1", { note: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});