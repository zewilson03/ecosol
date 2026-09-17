import React from "react";
import { createRoot } from "react-dom/client";
import RotasDaAplicacao from "./RotasDaAplicacao";
import "./estilos.css";

const elementoPrincipal = document.getElementById("root");
if (!elementoPrincipal) throw new Error("Elemento principal não encontrado.");

createRoot(elementoPrincipal).render(
  <React.StrictMode>
    <RotasDaAplicacao />
  </React.StrictMode>,
);
