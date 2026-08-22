import type { Meta, StoryObj } from "@storybook/react";
import { AppShell } from "@mantine/core";
import { UserButton } from "./UserButton";
import { BrowserRouter } from "react-router-dom";

interface MockUser {
  displayName: string;
  email: string;
}

const meta: Meta<typeof UserButton> = {
  title: "Examples/App Layout/UserButton",
  component: UserButton,
  tags: ["autodocs"],
  decorators: [
    (Story, context) => {
      const userData: MockUser = (context.parameters as { userData?: MockUser })?.userData || {
        displayName: "John Doe",
        email: "john.doe@example.com",
      };
      window.__ALPHASHRI_USER__ = userData;
      return (
        <BrowserRouter>
          <AppShell>
            <Story />
          </AppShell>
        </BrowserRouter>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof UserButton>;

export const Default: Story = {
  parameters: {
    userData: {
      displayName: "John Doe",
      email: "john.doe@example.com",
    },
  },
};

export const WithDifferentUser: Story = {
  parameters: {
    userData: {
      displayName: "Jane Smith",
      email: "jane.smith@example.com",
    },
  },
};
