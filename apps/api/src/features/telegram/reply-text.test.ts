import { describe, expect, it } from "vitest";
import type { ExecutionResult } from "./bot-brain";
import type { MovementCandidate } from "./movement-corrector";
import {
  amountConfirmationAbandonedReply,
  amountConflictReply,
  alreadyProcessedReply,
  askAmountReply,
  askCategoryReply,
  balanceQueryReply,
  capabilitiesSummaryReply,
  capturePromptReply,
  captureShapedRedirectReply,
  categoriesQueryReply,
  categoryCommandReplyTemplate,
  categoryCreatedReassignedReply,
  categoryCreatedReply,
  categoryCrudRedirectReply,
  categoryDeleteConfirmReply,
  categoryDeletedReply,
  categoryErrorReply,
  categoryFollowUpReply,
  categoryListReply,
  categoryNamePromptReply,
  categoryNotFoundReply,
  categoryRenamedReply,
  collectAbandonedReply,
  compartidoPrefixRedirectReply,
  correctionAbandonedReply,
  correctionDoneReply,
  correctionOfferReply,
  deletedMovementReply,
  deleteAskReply,
  deleteCancelledReply,
  deleteConfirmReply,
  deletePickListReply,
  duplicateCategoryReply,
  formatARS,
  greetingReply,
  helpReply,
  keptCollectingReply,
  keywordAssociatedReply,
  markPaidAlreadyReply,
  markPaidAskReply,
  markPaidReply,
  menuReply,
  ayudaReply,
  categoryButtonsReply,
  dialogClosedReply,
  missingCategoryReply,
  monthQueryReply,
  movementAmbiguousReply,
  movementCorrectionDoneReply,
  movementMissingReply,
  movementNoMatchReply,
  movementNoReferenceReply,
  movementSelectionAbandonedReply,
  nothingPendingReply,
  nothingToDeleteReply,
  otroDeleteForbiddenReply,
  otroKeptReply,
  pendingCapturePromptReply,
  plannedQueryReply,
  plannedReply,
  plannedSharedRejectedReply,
  previewAskCategoryReply,
  previewReply,
  previstoPrefixRedirectReply,
  queryReplyTemplate,
  questionDroppedReply,
  recentQueryReply,
  reservedCategoryReply,
  savingsOverrideRedirectReply,
  selectionAbandonedReply,
  setupBatchDoneReply,
  setupDoneReply,
  setupDoneWithRedirectsReply,
  setupQuestionReply,
  setupRetryReply,
  successReply,
  truncateNote,
  unresolvableReply,
} from "./reply-text";

describe("formatARS", () => {
  it("formats ARS amounts with the es-AR locale", () => {
    expect(formatARS(2500)).toBe("$\u00A02.500,00");
  });

  it("formats decimal amounts", () => {
    expect(formatARS(1500.5)).toBe("$\u00A01.500,50");
  });
});

describe("truncateNote", () => {
  it("keeps a short note unchanged", () => {
    expect(truncateNote("cafe")).toBe("cafe");
  });

  it("truncates a note longer than 500 chars with an ellipsis", () => {
    const long = "a".repeat(520);
    const result = truncateNote(long);

    expect(result).toHaveLength(500);
    expect(result.endsWith("…")).toBe(true);
    expect(result.slice(0, 499)).toBe("a".repeat(499));
  });
});

describe("reply builders", () => {
  it("builds a success confirmation with amount, note and category", () => {
    expect(successReply(2500, "cafe", "Cafe")).toBe(
      "Registrado: $\u00A02.500,00 (cafe) — Categoría: Cafe",
    );
  });

  it("builds a success confirmation without a note", () => {
    expect(successReply(8000, null, "otro")).toBe(
      "Registrado: $\u00A08.000,00 — Categoría: otro",
    );
  });

  it("truncates long notes inside the success reply", () => {
    const long = "x".repeat(600);
    const result = successReply(100, long, "Cafe");
    expect(result).toContain("…");
    expect(result.length).toBeLessThan(600);
  });

  it("builds the help text mentioning commands", () => {
    const text = helpReply();
    expect(text).toContain("No entendí");
    expect(text).toContain("registrar categoria");
    expect(text).toContain("renombrar categoria");
    expect(text).toContain("asociar palabra");
    expect(text).toContain("listar categorias");
    expect(text).toContain("configurar categorias");
  });

  it("redirects legacy text category CRUD to the 🗂 button flow", () => {
    const text = categoryCrudRedirectReply();

    expect(text).toContain("Administrar categorías");
    expect(text).toContain("🗂");
  });

it("builds the setup question", () => {
    expect(setupQuestionReply([])).toContain("categorías");
  });

  it("builds the setup retry question", () => {
    expect(setupRetryReply()).toContain("categoría");
  });

  it("builds the setup-done confirmation listing the created categories", () => {
    expect(setupDoneReply(["Cafe", "Transporte", "otro"])).toBe(
      'Categorías creadas: Cafe, Transporte, otro.',
    );
  });

  it("builds the setup-done reply with reserved redirects, confirming the created categories and teaching the blocked concepts", () => {
    const text = setupDoneWithRedirectsReply(
      ["Cafe", "otro"],
      [{ name: "gastos fijos", concept: "gasto fijo" }],
    );

    expect(text).toContain("Cafe");
    expect(text).toContain("otro");
    expect(text).toContain("gastos fijos");
    expect(text).toContain("previsto");
  });

  it.each([
    ["previsto", "previsto: <monto> <nota>"],
    ["gasto fijo", "previsto: <monto> <nota>"],
    ["ahorro", "registrar ahorro:"],
    ["compartido", "compartido:"],
    ["compartida", "compartido:"],
    ["otro", "respaldo"],
  ] as const)("builds the reserved redirect for the %s concept teaching the system usage", (concept, teaches) => {
    const text = reservedCategoryReply("gastos fijos", concept);

    expect(text).toContain("gastos fijos");
    expect(text).toContain(teaches);
  });

  it("builds the correction offer confirming the registration first and then offering reassignment", () => {
    expect(correctionOfferReply(2500, "capuchino", "otro")).toBe(
      'Registrado: $\u00A02.500,00 (capuchino) — Categoría: otro. ¿Querés asignarle otra categoría? Escribí el nombre o "no".',
    );
  });

  it("builds the correction done confirmation", () => {
    expect(correctionDoneReply("Transporte")).toBe('Listo, el movimiento quedó en "Transporte".');
  });

  it("builds the keep-as-otro confirmation", () => {
    expect(otroKeptReply()).toBe('Listo, quedó en "otro".');
  });

  it("builds the follow-up asking which category to reassign after an affirmation", () => {
    expect(categoryFollowUpReply()).toBe(
      'Dale, ¿a qué categoría lo asigno? Escribí el nombre o "no".',
    );
  });

  it("builds the category-not-found reply listing the existing categories", () => {
    const reply = categoryNotFoundReply("Zapateria", ["Cafe", "otro"]);
    expect(reply).toContain('"Zapateria"');
    expect(reply).toContain('"Cafe"');
    expect(reply).toContain('"otro"');
  });

  it("builds the abandoned-correction warning", () => {
    expect(correctionAbandonedReply()).toContain("otro");
  });

  it("builds the amount-conflict reply showing both formatted amounts", () => {
    const reply = amountConflictReply(5000, 4800);

    expect(reply).toContain(formatARS(5000));
    expect(reply).toContain(formatARS(4800));
    expect(reply).toContain("Respondé con el monto, o mandá un registro nuevo y lo descarto");
  });

  it("builds the amount-confirmation abandonment reply", () => {
    const reply = amountConfirmationAbandonedReply();

    expect(reply).toContain("monto");
    expect(reply).toContain("registro");
  });

  it("builds command confirmations", () => {
    expect(categoryCreatedReply("Salud")).toBe('Categoría "Salud" creada.');
    expect(categoryRenamedReply("Cafe", "Cafeteria")).toBe(
      'Categoría renombrada: "Cafe" → "Cafeteria".',
    );
    expect(keywordAssociatedReply("uber", "Transporte")).toBe(
      'Palabra "uber" asociada a "Transporte".',
    );
  });

  it("builds the delete confirmation and the otro-guard warning", () => {
    expect(categoryDeletedReply("Viajes")).toBe('Categoría "Viajes" borrada.');
    expect(otroDeleteForbiddenReply()).toContain("otro");
  });

  it("builds a capabilities summary listing what the bot can do", () => {
    const summary = capabilitiesSummaryReply();

    expect(summary).toContain("registrar");
    expect(summary).toContain("consultar");
    expect(summary).toContain("borrar");
    expect(summary).toContain("renombrar");
    expect(summary).toContain("asociar");
  });

  it("builds command error replies", () => {
    expect(duplicateCategoryReply("Salud")).toContain("Salud");
    expect(missingCategoryReply("Salud")).toContain("Salud");
    expect(categoryErrorReply("boom")).toBe("Error: boom");
    expect(movementMissingReply()).toContain("no existe");
  });

  it("builds a category list with keywords", () => {
    const list = categoryListReply([
      { name: "Cafe", keywords: ["cafe"] },
      { name: "otro", keywords: [] },
    ]);
    expect(list).toContain("Cafe");
    expect(list).toContain("cafe");
    expect(list).toContain("otro");
  });

  it("builds an empty category list message", () => {
    expect(categoryListReply([])).toBe("No hay categorías.");
  });
});

describe("query reply templates", () => {
  it("lists the categories with their keywords", () => {
    const text = categoriesQueryReply([
      { name: "Cafe", keywords: ["cafe"] },
      { name: "otro", keywords: [] },
    ]);

    expect(text).toContain("Cafe");
    expect(text).toContain("cafe");
    expect(text).toContain("otro");
  });

  it("warns when there are no categories", () => {
    expect(categoriesQueryReply([])).toContain("categorías");
  });

  it("lists the recent movements with amount, category, note and date", () => {
    const text = recentQueryReply([
      { amount: 2500, category: "Cafe", note: "cafe con leche", date: "2026-09-17", type: "EXPENSE" },
      { amount: 50000, category: null, note: null, date: "2026-09-16", type: "INCOME" },
    ]);

    expect(text).toContain(formatARS(2500));
    expect(text).toContain("Cafe");
    expect(text).toContain("cafe con leche");
    expect(text).toContain("17/09");
    expect(text).toContain(formatARS(50000));
    expect(text).toContain("ingreso");
  });

  it("warns when there are no movements", () => {
    expect(recentQueryReply([])).toContain("movimientos");
  });

  it("builds the balance reply from income minus expenses", () => {
    const text = balanceQueryReply(1000, 3000, 2000);

    expect(text).toContain(formatARS(1000));
    expect(text).toContain(formatARS(3000));
    expect(text).toContain(formatARS(2000));
  });

  it("builds the month summary reply", () => {
    const text = monthQueryReply("2026-09", 3000, 2000, 4);

    expect(text).toContain(formatARS(2000));
    expect(text).toContain(formatARS(3000));
    expect(text).toContain("4");
  });

  it("selects the fixed template per query_type", () => {
    expect(queryReplyTemplate({ query_type: "categories", categories: [] })).toContain("categorías");
    expect(queryReplyTemplate({ query_type: "recent", movements: [] })).toContain("movimientos");
    expect(queryReplyTemplate({ query_type: "balance", balance: 1, income: 2, expenses: 1 })).toContain("balance");
    expect(
      queryReplyTemplate({ query_type: "month", month: "2026-09", monthIncome: 1, monthExpenses: 2, monthCount: 3 }),
    ).toContain("septiembre");
    expect(queryReplyTemplate({ query_type: "planned", month: "2026-10", total: 4000 })).toContain("previsto");
    expect(queryReplyTemplate({ query_type: "planned", month: "2026-10", total: 4000 })).toContain(formatARS(4000));
  });

  it("builds the planned-query reply from the executed month and total", () => {
    const text = plannedQueryReply("2026-10", 4000);

    expect(text).toContain("previsto");
    expect(text).toContain(formatARS(4000));
  });

  it("answers zero for the planned-query reply when nothing is pending", () => {
    expect(plannedQueryReply("2026-10", 0)).toContain(formatARS(0));
  });

  it("confirms a planned registration without implying it already counts in the balance", () => {
    const text = plannedReply(2500, "alquiler", "Vivienda");

    expect(text).toContain("previsto");
    expect(text).toContain(formatARS(2500));
    expect(text).toContain("Vivienda");
    expect(text).toContain("alquiler");
  });

  it("confirms a planned registration without a note", () => {
    expect(plannedReply(2500, null, "Vivienda")).toContain(formatARS(2500));
  });

  it("redirects compartido+previsto with the individual-planned teaching", () => {
    const text = plannedSharedRejectedReply();

    expect(text).toContain("individuales");
    expect(text).toContain("previsto: monto nota");
    expect(text).toContain("compartido: monto nota");
  });
});

function categoryResult(overrides: Partial<ExecutionResult>): ExecutionResult {
  return {
    intent: "create_category",
    ok: true,
    action: "created",
    amount: null,
    category: "Mascotas",
    note: null,
    ...overrides,
  };
}

describe("category command reply templates", () => {
  it("confirms a created category", () => {
    const text = categoryCommandReplyTemplate(categoryResult({ intent: "create_category", category: "Mascotas" }));

    expect(text).toBe('Categoría "Mascotas" creada.');
  });

  it("reports a duplicate on create", () => {
    const text = categoryCommandReplyTemplate(
      categoryResult({ intent: "create_category", ok: false, error: "duplicate", category: "Mascotas", message: "already exists" }),
    );

    expect(text).toContain("Ya existe");
    expect(text).toContain("Mascotas");
  });

  it("renders the reserved redirect message for a reserved create", () => {
    const message = reservedCategoryReply("previsto", "previsto");
    const text = categoryCommandReplyTemplate(
      categoryResult({ intent: "create_category", ok: false, error: "reserved", category: "previsto", message }),
    );

    expect(text).toBe(message);
    expect(text).toContain("previsto: <monto> <nota>");
  });

  it("renders the reserved redirect message for a reserved rename", () => {
    const message = reservedCategoryReply("ahorros", "ahorro");
    const text = categoryCommandReplyTemplate(
      categoryResult({ intent: "rename_category", ok: false, error: "reserved", category: "Guardado", new_name: "ahorros", message }),
    );

    expect(text).toBe(message);
    expect(text).toContain("registrar ahorro");
  });

  it("confirms a deleted category", () => {
    const text = categoryCommandReplyTemplate(categoryResult({ intent: "delete_category", category: "Viajes" }));

    expect(text).toBe('Categoría "Viajes" borrada.');
  });

  it("reports a missing category on delete", () => {
    const text = categoryCommandReplyTemplate(
      categoryResult({ intent: "delete_category", ok: false, error: "not_found", category: "Viajes", message: "not found" }),
    );

    expect(text).toContain("No existe");
  });

  it("refuses to delete the otro fallback", () => {
    const text = categoryCommandReplyTemplate(
      categoryResult({ intent: "delete_category", ok: false, error: "otro_forbidden", category: "otro", message: "fallback" }),
    );

    expect(text).toContain("otro");
    expect(text).not.toContain("No existe");
  });

  it("confirms a rename with both names", () => {
    const text = categoryCommandReplyTemplate(
      categoryResult({ intent: "rename_category", category: "Super", new_name: "Supermercado" }),
    );

    expect(text).toContain("Super");
    expect(text).toContain("Supermercado");
  });

  it("reports a duplicate on rename", () => {
    const text = categoryCommandReplyTemplate(
      categoryResult({ intent: "rename_category", ok: false, error: "duplicate", category: "Super", new_name: "Supermercado", message: "already exists" }),
    );

    expect(text).toContain("Ya existe");
    expect(text).toContain("Supermercado");
  });

  it("falls back to the capabilities summary for the capabilities intent", () => {
    const text = categoryCommandReplyTemplate(
      categoryResult({ intent: "capabilities", ok: true, action: "capabilities" }),
    );

    expect(text).toBe(capabilitiesSummaryReply());
  });
});

describe("movement correction reply templates", () => {
  const candidates: MovementCandidate[] = [
    { id: "m1", amount: 2500, note: "uber", date: "2026-09-19", type: "EXPENSE" },
    { id: "m2", amount: 2500, note: "super", date: "2026-09-17", type: "EXPENSE" },
  ];

  it("asks which movement to correct with numbered date, amount and note lines", () => {
    const text = movementAmbiguousReply({ amount: 2500, note: null }, candidates);

    expect(text).toContain("¿Cuál de estos movimientos corrijo?");
    expect(text).toContain(`1) 19/09 · ${formatARS(2500)} · uber`);
    expect(text).toContain(`2) 17/09 · ${formatARS(2500)} · super`);
  });

  it("asks which movement when no reference was extracted, listing the candidates", () => {
    const text = movementNoReferenceReply(candidates);

    expect(text).toContain("¿Qué movimiento querés corregir?");
    expect(text).toContain(`1) 19/09 · ${formatARS(2500)} · uber`);
    expect(text).toContain(`2) 17/09 · ${formatARS(2500)} · super`);
  });

  it("builds the no-match reply", () => {
    expect(movementNoMatchReply()).toContain("No encontré");
    expect(movementNoMatchReply()).toContain("movimiento");
  });

  it("builds the selection-abandoned reply without claiming a change", () => {
    const text = movementSelectionAbandonedReply();

    expect(text).toContain("corrección");
    expect(text).not.toContain("quedó");
    expect(text).not.toContain("registrado");
  });

  it("builds the phantom-guard dropped reply without 'now registering' wording", () => {
    const text = questionDroppedReply();

    expect(text).toContain("pregunta");
    expect(text).not.toContain("registro");
    expect(text).not.toContain("Ahora registro");
  });

  it("confirms a reassignment with the movement facts", () => {
    const text = movementCorrectionDoneReply("gastos hormiga", 2500, "uber");

    expect(text).toContain(formatARS(2500));
    expect(text).toContain("uber");
    expect(text).toContain("gastos hormiga");
  });

  it("confirms a reassignment without a note", () => {
    expect(movementCorrectionDoneReply("Transporte", 900, null)).toContain(formatARS(900));
  });

  it("confirms the mixed create + reassign in one reply", () => {
    expect(categoryCreatedReassignedReply("gastos hormiga")).toContain("gastos hormiga");
    expect(categoryCreatedReassignedReply("gastos hormiga")).toContain("creada");
  });

  it("routes a created_reassigned action to the mixed confirmation template", () => {
    const text = categoryCommandReplyTemplate(
      categoryResult({ intent: "create_category", category: "gastos hormiga", action: "created_reassigned" }),
    );

    expect(text).toBe(categoryCreatedReassignedReply("gastos hormiga"));
  });
});

describe("registration collection reply templates", () => {
  it("asks for the amount, echoing the collected note when present", () => {
    const text = askAmountReply("gym");

    expect(text).toContain("¿Qué monto tiene el gasto (gym)?");
    expect(text).toContain("Mandame el número.");
  });

  it("asks for the amount without a note when the collect has none", () => {
    expect(askAmountReply(null)).toBe("¿Qué monto tiene el gasto? Mandame el número.");
  });

  it("asks for the category, echoing the collected note when present", () => {
    const text = askCategoryReply("alquiler");

    expect(text).toContain("¿En qué categoría lo guardo (alquiler)?");
    expect(text).toContain("Mandame el nombre.");
  });

  it("asks for the category without a note when the collect has none", () => {
    expect(askCategoryReply(null)).toBe("¿En qué categoría lo guardo? Mandame el nombre.");
  });

  it("re-asks the open amount field when a non-answer arrives", () => {
    const text = keptCollectingReply("amount");

    expect(text).toContain("Sigo con el registro: falta el monto.");
    expect(text).toContain('Si querés cancelarlo, mandá "no, dejalo".');
  });

  it("re-asks the open category field when a non-answer arrives", () => {
    const text = keptCollectingReply("category");

    expect(text).toContain("Sigo con el registro: falta el nombre de la categoría.");
    expect(text).toContain('Si querés cancelarlo, mandá "no, dejalo".');
  });

  it("confirms the abandoned collect without claiming a registration", () => {
    const text = collectAbandonedReply();

    expect(text).toContain("cancelé el registro");
    expect(text).toContain("No guardé nada");
  });

it("greets warmly and expense-scoped, pointing to the menu", () => {
    const text = greetingReply();

    expect(text).toContain("¡Hola!");
    expect(text).toContain("gastos");
    expect(text).toContain("menú");
  });
});

describe("bot expense lifecycle reply templates", () => {
  it("confirms a marked-paid transition with amount, note and category", () => {
    expect(markPaidReply(2500, "alquiler", "Vivienda")).toBe(
      'Listo, marqué como pagado: $\u00A02.500,00 (alquiler) — Categoría: Vivienda.',
    );
  });

  it("confirms a marked-paid transition without a category when it is unknown", () => {
    expect(markPaidReply(2500, null, null)).toBe('Listo, marqué como pagado: $\u00A02.500,00.');
  });

  it("builds the already-paid conflict notice", () => {
    expect(markPaidAlreadyReply()).toBe("Ese movimiento ya estaba pagado: no cambié nada.");
  });

  it("builds the nothing-pending reply", () => {
    expect(nothingPendingReply()).toBe("No encontré ningún gasto previsto pendiente que coincida con eso.");
  });

  it("builds the nothing-to-delete reply stating nothing was deleted", () => {
    expect(nothingToDeleteReply()).toBe("No encontré ningún movimiento que coincida con eso para borrar. No borré nada.");
  });

  it("confirms a deleted expense with amount, note and category", () => {
    expect(deletedMovementReply(2500, "cafe", "Cafe")).toBe('Borré el gasto: $\u00A02.500,00 (cafe) — Categoría: Cafe.');
  });

  it("asks which planned expense was paid with numbered candidates", () => {
    const text = markPaidAskReply([
      { amount: 2500, note: "alquiler", date: "2026-09-19" },
      { amount: 2500, note: "gym", date: "2026-09-17" },
    ]);

    expect(text).toContain("¿Cuál de estos gastos previstos marcaste como pagado?");
    expect(text).toContain("1) 19/09 · $\u00A02.500,00 · alquiler");
    expect(text).toContain("2) 17/09 · $\u00A02.500,00 · gym");
  });

  it("asks which expense to delete with numbered candidates", () => {
    const text = deleteAskReply([{ amount: 8000, note: "super", date: "2026-09-18" }]);

    expect(text).toContain("¿Cuál de estos gastos querés borrar?");
    expect(text).toContain("1) 18/09 · $\u00A08.000,00 · super");
  });

  it("builds the setup question without categories (today's text plus command examples)", () => {
    const text = setupQuestionReply([]);

    expect(text).toContain("categorías");
    expect(text).toContain("borrar categoria: X");
    expect(text).toContain("renombrar categoria: X a: Y");
  });

  it("builds the setup question listing the existing categories", () => {
    const text = setupQuestionReply(["Cafe", "Transporte"]);

    expect(text).toContain("Tus categorías actuales:");
    expect(text).toContain("- Cafe");
    expect(text).toContain("- Transporte");
    expect(text).toContain("borrar categoria: X");
  });

  it("builds the batch-done summary with created, deleted and renamed entries", () => {
    const text = setupBatchDoneReply({
      created: ["Salud", "otro"],
      redirects: [],
      deleted: ["no"],
      renamed: [{ from: "Cafe", to: "Cafeteria" }],
    });

    expect(text).toContain("Categorías creadas: Salud, otro.");
    expect(text).toContain("Borradas: no.");
    expect(text).toContain('"Cafe" a "Cafeteria"');
  });

  it("builds the batch-done summary with reserved redirects", () => {
    const text = setupBatchDoneReply({
      created: ["otro"],
      redirects: [{ name: "gastos fijos", concept: "gasto fijo" }],
      deleted: [],
      renamed: [],
    });

    expect(text).toContain("gastos fijos");
    expect(text).toContain("previsto");
  });

it("lists mark-paid and delete in the capabilities summary", () => {
    const summary = capabilitiesSummaryReply();

    expect(summary).toContain("marcar como pagado");
    expect(summary).toContain("borrar un gasto");
  });
});

describe("dialog category buttons (D9)", () => {
  it("builds the category-buttons prompt asking the owner to pick", () => {
    const text = categoryButtonsReply();

    expect(text).toContain("Elegí una de estas");
    expect(text).toContain("otro");
  });

  it("builds the closed-dialog reply for a stale category callback", () => {
    expect(dialogClosedReply()).toContain("cerrado");
    expect(dialogClosedReply()).toContain("no");
  });
});

describe("main menu and help templates (D8/D12)", () => {
  it("builds the menu text inviting the owner to choose", () => {
    const text = menuReply();

    expect(text).toContain("menú");
    expect(text.length).toBeGreaterThan(0);
  });

  it("builds the static help explaining the eight buttons with examples and never teaching prefixes (spec: Static Help)", () => {
    const text = ayudaReply();

    expect(text).toContain("Nuevo gasto");
    expect(text).toContain("30000 gym");
    expect(text).toContain("Administrar categorías");
    expect(text).toContain("no se cargan");
    expect(text).toContain("listar categorias");
    expect(text).not.toContain("previsto:");
    expect(text).not.toContain("compartido:");
  });
});

describe("delete confirmation gate templates (D6)", () => {
  it("builds the delete confirmation naming the candidate facts", () => {
    const text = deleteConfirmReply(2500, "alquiler", "Alquiler");

    expect(text).toContain(formatARS(2500));
    expect(text).toContain("alquiler");
    expect(text).toContain("Alquiler");
    expect(text).toContain("Borrar");
  });

  it("builds the cancelled reply stating nothing was deleted", () => {
    expect(deleteCancelledReply()).toContain("cancelé");
    expect(deleteCancelledReply()).toContain("nada");
  });

  it("builds the pick-list reply listing the delete candidates", () => {
    const text = deletePickListReply([{ amount: 2500, note: "alquiler", date: "2026-09-19" }]);

    expect(text).toContain("¿Cuál");
    expect(text).toContain("borrar");
    expect(text).toContain(formatARS(2500));
    expect(text).toContain("alquiler");
  });
});

describe("quick-capture preview templates (D4 v2)", () => {
  it("builds the v2 preview asking Guardamos with amount, note and the real type label", () => {
    const text = previewReply(30000, "gym", "REAL");

    expect(text).toContain("¿Guardamos?");
    expect(text).toContain(formatARS(30000));
    expect(text).toContain("gym");
    expect(text).toContain("real");
  });

  it("marks a PENDING preview as previsto", () => {
    const text = previewReply(2500, "alquiler", "PENDING");

    expect(text).toContain("¿Guardamos?");
    expect(text).toContain(formatARS(2500));
    expect(text).toContain("alquiler");
    expect(text).toContain("previsto");
  });

  it("labels an INGRESO preview as ingreso", () => {
    const text = previewReply(1000, null, "INGRESO");

    expect(text).toContain("¿Guardamos?");
    expect(text).toContain(formatARS(1000));
    expect(text).toContain("ingreso");
  });

  it("labels a COMPARTIDO preview as compartido", () => {
    const text = previewReply(2000, "super", "COMPARTIDO");

    expect(text).toContain("compartido");
  });

  it("never renders a pre-resolved category in the v2 preview text", () => {
    const text = previewReply(30000, "gym", "REAL");

    expect(text).not.toContain("Categoría");
  });

  it("builds the capture prompt asking for a short amount+note text", () => {
    const text = capturePromptReply();

    expect(text).toContain("monto");
    expect(text).toContain("nota");
  });

  it("builds the pending-capture prompt teaching the previsto: prefix and the Previsto button", () => {
    const text = pendingCapturePromptReply();

    expect(text).toContain("previsto:");
    expect(text).toContain("Previsto");
  });

  it("builds the already-processed reply for a retried callback", () => {
    expect(alreadyProcessedReply()).toContain("ya fue procesada");
  });
});

describe("v2 redirect and flow templates (bot-free-text-routing / quick-capture)", () => {
  it("asks for a category when Guardar is tapped without a selection", () => {
    const text = previewAskCategoryReply();

    expect(text).toContain("categoría");
    expect(text).toContain("Guardar");
  });

  it("redirects capture-shaped text to the ➕ Nuevo gasto button", () => {
    const text = captureShapedRedirectReply();

    expect(text).toContain("➕ Nuevo gasto");
    expect(text).toContain("mandalo");
  });

  it("redirects the previsto: prefix to the 📅 Gasto previsto button", () => {
    const text = previstoPrefixRedirectReply();

    expect(text).toContain("📅 Gasto previsto");
    expect(text).toContain("previsto");
  });

  it("redirects the compartido: prefix to the 👥 Compartido button", () => {
    const text = compartidoPrefixRedirectReply();

    expect(text).toContain("👥 Compartido");
  });

  it("redirects savings-override text to the automatic rule", () => {
    const text = savingsOverrideRedirectReply();

    expect(text).toContain("ahorro");
    expect(text).toContain("automáticamente");
  });

  it("replies the unresolvable fallback", () => {
    const text = unresolvableReply();

    expect(text.toLowerCase()).toContain("no puedo resolver eso");
  });

  it("prompts for a category name in the preview flow", () => {
    const text = categoryNamePromptReply("preview");

    expect(text).toContain("categoría");
  });

  it("prompts for a category name in the admin create flow", () => {
    const text = categoryNamePromptReply("admin_create");

    expect(text).toContain("crear");
  });

  it("prompts for a category name in the admin rename flow", () => {
    const text = categoryNamePromptReply("admin_rename");

    expect(text).toContain("nombre");
  });

  it("asks for the category-delete confirmation naming the category", () => {
    const text = categoryDeleteConfirmReply("Viajes");

    expect(text).toContain("Viajes");
    expect(text).toContain("Borrar");
  });

  it("reports the pick abandonment without claiming changes", () => {
    const text = selectionAbandonedReply();

    expect(text).toContain("abandoné");
    expect(text).toContain("no cambié nada");
  });
});