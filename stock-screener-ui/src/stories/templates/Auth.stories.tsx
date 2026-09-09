import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { LoginForm, RegisterForm } from "@/components/auth/LoginForm2";

const meta: Meta = {
  title: "Templates/Auth",
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Auth — centered Login/Register forms with validation and switch links. Use for unauthenticated /login and /register routes. When not: for authenticated pages use Application Shell instead.",
      },
    },
  },
  decorators: [(Story) => <MemoryRouter><Story /></MemoryRouter>],
};
export default meta;

export const Login: StoryObj = {
  render: () => <LoginForm onSwitchToRegister={() => {}} onSuccess={() => {}} />,
};

export const Register: StoryObj = {
  render: () => <RegisterForm onSwitchToLogin={() => {}} onSuccess={() => {}} />,
};
