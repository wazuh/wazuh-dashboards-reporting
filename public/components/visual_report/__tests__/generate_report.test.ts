/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

// WAZUH: file added to cover the report footer missing from the capture (issue #226)

import html2canvas from 'html2canvas';
import { generateReport } from '../generate_report';
import { uiSettingsService } from '../../utils/settings_service';

jest.mock('html2canvas', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('jspdf', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('tesseract.js', () => ({ createWorker: jest.fn() }));
jest.mock('uuid', () => ({ v1: () => 'test-uuid' }));
jest.mock('../../utils/settings_service', () => ({
  uiSettingsService: {
    get: jest.fn(),
    getHttpClient: jest.fn(),
  },
}));

const HEADER_MARKER = 'UXA2-HEADER-MARKER';
const FOOTER_MARKER = 'UXA2-FOOTER-MARKER';

const buildReport = () => ({
  report_definition: {
    report_params: {
      report_name: 'test report',
      report_source: 'Dashboard',
      core_params: {
        report_format: 'png',
        header: HEADER_MARKER,
        footer: FOOTER_MARKER,
      },
    },
  },
});

/**
 * `html2canvas` is mocked, so it never calls `onclone`. Snapshot the state of the
 * document at the moment it is called, which is what a real capture rasterises.
 */
const captureCallState = () => {
  const state: {
    html?: string;
    height?: number;
    footerBottom?: number;
    footerPosition?: string;
  } = {};
  (html2canvas as jest.Mock).mockImplementation((_element, options) => {
    state.html = document.body.innerHTML;
    state.height = options.height;
    const footer = document.querySelector('#reportingFooter');
    const footerWrapper = footer?.closest<HTMLElement>('.reportWrapper');
    state.footerPosition = footerWrapper?.style.position;
    state.footerBottom = footer
      ? footer.getBoundingClientRect().bottom + window.scrollY
      : undefined;
    return Promise.resolve({
      width: 100,
      height: 100,
      toDataURL: () => 'data:image/png;base64,',
    });
  });
  return state;
};

describe('generateReport', () => {
  beforeEach(() => {
    // The PNG branch downloads through an anchor, which jsdom cannot navigate
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation();
    document.body.innerHTML = '<div id="dashboardViewport">content</div>';
    (uiSettingsService.getHttpClient as jest.Mock).mockReturnValue({
      get: jest.fn().mockResolvedValue(buildReport()),
    });
  });

  it.each([
    ['foreign object rendering enabled', true],
    ['foreign object rendering disabled', false],
  ])(
    'captures the header and the footer with %s',
    async (_name, useForeignObjectRendering) => {
      (uiSettingsService.get as jest.Mock).mockImplementation((key: string) =>
        key === 'reporting:useFOR' ? useForeignObjectRendering : false
      );
      const state = captureCallState();

      await generateReport('report-id', 0);

      expect(state.html).toContain(HEADER_MARKER);
      expect(state.html).toContain(FOOTER_MARKER);
      // The footer must fit inside the captured area, otherwise it is cropped out
      expect(state.height).toBeGreaterThanOrEqual(state.footerBottom!);
      /* `html2canvas` lays the clone out in a viewport as tall as the capture, which
       * inflates the `vh`/`%` sized ancestors of the footer and pushes it off the
       * bottom edge unless it is pinned out of the flow.
       */
      expect(state.footerPosition).toBe('absolute');
    }
  );

  it('removes the injected header, footer and styles once done', async () => {
    (uiSettingsService.get as jest.Mock).mockImplementation(
      (key: string) => key === 'reporting:useFOR'
    );
    captureCallState();

    await generateReport('report-id', 0);

    expect(document.querySelectorAll('.reportWrapper')).toHaveLength(0);
    expect(document.querySelectorAll('.reportInjectedStyles')).toHaveLength(0);
  });
});
