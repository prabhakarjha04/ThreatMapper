import { ComponentMeta, ComponentStory } from '@storybook/react';

import Button from '@/components/button/Button';
import { Popover } from '@/components/popover/Popover';
import { Checkbox } from '@/main';

export default {
  title: 'Components/Popover',
  component: Popover,
  argTypes: {
    align: {
      defaultValue: undefined,
      options: [undefined, 'start', 'center', 'end'],
    },
  },
} as ComponentMeta<typeof Popover>;

const DefaultTemplate: ComponentStory<typeof Popover> = (args) => {
  return (
    <Popover
      {...args}
      content={
        <div className="p-3 text-gray-700 dark:text-gray-400">
          This is popver content
          <Checkbox label="test" checked={false} />
        </div>
      }
    >
      <Button color="primary">Click me</Button>
    </Popover>
  );
};

export const Default = DefaultTemplate.bind({});
Default.args = {
  triggerAsChild: true,
};
