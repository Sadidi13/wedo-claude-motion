/**
 * Public entry of the Motion Studio runtime. Re-exports `./motion` so the
 * loader (`@/runtime`) and project code (`./animations.jsx` alias) see one
 * module instance with the contract's exports (CONTRACTS.md §1).
 */
export * from "./motion";
