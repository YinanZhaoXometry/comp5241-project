import { baseline, severity } from "./lint-baseline.mjs";

export const parserHandled = new Set(["react/jsx-uses-react", "react/jsx-uses-vars"]);
export const stronger = new Set(["react/no-deprecated", "@next/next/no-location-assign-relative-destination"]);
export const eslintRules = Object.fromEntries(Object.entries(baseline).filter(([key, value]) =>
  severity(value) && (!key.includes("/") || key.startsWith("@typescript-eslint/") || key.startsWith("react-hooks/")),
));
export const nativeRules = Object.fromEntries(Object.entries(baseline)
  .filter(([key, value]) => severity(value) && key.includes("/") && !(key in eslintRules) && !parserHandled.has(key) && !stronger.has(key))
  .map(([key, value]) => [key.replace("@next/next/", "nextjs/"), value]));

// Stronger, executable alternatives for the two rules without native ports.
// Function components only; deny legacy React/ReactDOM APIs and all location
// navigation (not just relative destinations). Next navigation remains available.
export const restrictions = {
  "no-restricted-syntax": ["error", { selector: "ClassDeclaration, ClassExpression", message: "Use function components and plain data; legacy React classes are prohibited." }],
  "no-restricted-imports": ["error", {
    paths: ["react-dom", { name: "react", importNames: ["createClass", "createFactory", "PropTypes", "DOM"], message: "Deprecated React API." }],
  }],
  "no-restricted-properties": ["error", ...["createClass", "createFactory", "PropTypes", "DOM", "location"].map(property => ({ property, message: "Deprecated React API or unmanaged navigation is prohibited." }))],
  "no-restricted-globals": ["error", "location"],
};