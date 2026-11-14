import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Link, MemoryRouter } from 'react-router-dom';
import { Button } from './button';

afterEach(cleanup);

describe('Button', () => {
  it('slots asChild onto a single child element', () => {
    render(
      <MemoryRouter>
        <Button asChild>
          <Link to="/register">Start monitoring</Link>
        </Button>
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'Start monitoring' });
    expect(link.tagName).toBe('A');
    expect(link.className).toContain('inline-flex');
  });

  it('keeps the loading indicator on a normal button', () => {
    render(<Button loading>Save</Button>);

    const button = screen.getByRole('button', { name: /save/i });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.querySelector('svg')).not.toBeNull();
  });
});
