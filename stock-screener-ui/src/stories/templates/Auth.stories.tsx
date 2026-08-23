import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { LoginForm, RegisterForm } from "@/components/auth/LoginForm2";

const meta: Meta = {
  title: "Templates/Auth",
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  decorators: [(Story) => <MemoryRouter><Story /></MemoryRouter>],
};
export default meta;

export const Login: StoryObj = {
  render: () => <LoginForm onSwitchToRegister={() => {}} onSuccess={() => {}} />,
};

export const Register: StoryObj = {
  render: () => <RegisterForm onSwitchToLogin={() => {}} onSuccess={() => {}} />,
};
