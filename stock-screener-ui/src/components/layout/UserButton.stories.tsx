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
  parameters: { docs: { description: { component: "User avatar + name button for AppShell navbar/footer. Use for account menu and logout. When not: for generic user display use Avatar + Text." } } },
  decorators: [
    (Story, context) => {
      const params = context.parameters as { userData?: MockUser | null; unauthenticated?: boolean };
      if (params?.unauthenticated) {
        delete (window as unknown as Record<string, unknown>).__ALPHASHRI_USER__;
      } else {
        const userData: MockUser = params?.userData || {
          displayName: "John Doe",
          email: "john.doe@example.com",
        };
        window.__ALPHASHRI_USER__ = userData;
      }
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

export const Unauthenticated: Story = {
  parameters: {
    unauthenticated: true,
  },
};

export const LongNameTruncation: Story = {
  parameters: {
    userData: {
      displayName: "Dr. Very Long Name That Should Truncate",
      email: "very.long.email.that.should.truncate@example.com",
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 180, border: "1px dashed var(--mantine-color-dimmed)" }}>
        <Story />
      </div>
    ),
  ],
};

// UserButton has no `loading` prop — it reads synchronously from window.__ALPHASHRI_USER__.
// No Loading story needed; async auth state is handled by AuthProvider2 outside this component.
