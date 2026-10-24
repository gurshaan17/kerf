import { expect, test } from '@playwright/test';
import { launchKerf } from './helpers';

test('boots into the project browser', async () => {
  const kerf = await launchKerf();
  try {
    await expect(
      kerf.page.getByRole('heading', { name: 'Your projects' }),
    ).toBeVisible();
  } finally {
    await kerf.close();
  }
});
