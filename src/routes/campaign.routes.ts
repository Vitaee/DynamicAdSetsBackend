import { Router } from 'express';

const router = Router();

// TODO: Implement campaign routes
router.get('/', (_req, res) => {
  res.json({ message: 'List campaigns - TODO' });
});

router.get('/:id', (_req, res) => {
  res.json({ message: 'Get campaign - TODO' });
});

router.post('/', (_req, res) => {
  res.json({ message: 'Create campaign - TODO' });
});

router.put('/:id', (_req, res) => {
  res.json({ message: 'Update campaign - TODO' });
});

router.delete('/:id', (_req, res) => {
  res.json({ message: 'Delete campaign - TODO' });
});

export default router;