import "@mantine/core/styles.css";
import "./style.css";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { MantineProvider, ColorSchemeScript } from "@mantine/core";
import App from "./App";
import { store } from "./store";
import { theme } from "./theme";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app root element");
}

createRoot(root).render(
  <Provider store={store}>
    <ColorSchemeScript defaultColorScheme="dark" />
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MantineProvider>
  </Provider>,
);
