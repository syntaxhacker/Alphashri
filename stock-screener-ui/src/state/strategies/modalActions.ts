/**
 * Re-exports modal actions from strategies.ts.
 * The actual implementations live in strategies.ts to avoid stale state references
 * from circular imports (modalActions imported `state` which gets reassigned).
 */
export { openCreateModal, closeCreateModal, openEditModal, closeEditModal } from "../strategies";
