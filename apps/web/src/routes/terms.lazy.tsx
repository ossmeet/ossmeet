import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Video } from "lucide-react";

export const Route = createLazyFileRoute("/terms")({
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <Link
            to="/"
            className="flex items-center gap-2 text-neutral-500 transition-colors hover:text-accent-700"
          >
            <ArrowLeft size={16} />
            <Video size={20} className="text-accent-700" />
            <span className="font-bold text-primary-950">OSSMeet</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl animate-fade-in px-6 py-16">
        <h1 className="text-2xl font-bold text-neutral-900">Terms of Service</h1>
        <p className="mt-2 text-sm text-neutral-500">Last updated: April 22, 2026</p>

        <div className="mt-10 space-y-10 text-neutral-700 leading-relaxed">
          {/* 1. Acceptance of Terms */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">1. Acceptance of Terms</h2>
            <p className="mt-3">
              By accessing or using OSSMeet (<a href="https://ossmeet.com" className="text-accent-700 underline">ossmeet.com</a>), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to all of these Terms, you may not access or use the Service. You must be at least 13 years of age to use OSSMeet. If you are under 18, you represent that your parent or legal guardian has reviewed and agreed to these Terms on your behalf.
            </p>
          </section>

          {/* 2. Description of Service */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">2. Description of Service</h2>
            <p className="mt-3">
              OSSMeet is an open-source video meeting platform that provides real-time video conferencing, text chat, collaborative whiteboard, cloud recording, transcription, AI-assisted meeting features, and PDF export. The platform is built on open-source technologies and its source code is available under the MIT license. Real-time media infrastructure (audio, video, screen sharing) is self-hosted on our own dedicated servers.
            </p>
          </section>

          {/* 3. Account Registration */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">3. Account Registration</h2>
            <p className="mt-3">
              To access certain features, you must create an account by authenticating through Google OAuth. By signing in, you authorize OSSMeet to receive your name, email address, and profile picture from Google. You are responsible for maintaining the security of your Google account credentials and for all activities that occur under your OSSMeet account. You agree to notify us immediately of any unauthorized use of your account.
            </p>
          </section>

          {/* 4. Subscription Plans & Billing */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">4. Subscription Plans &amp; Billing</h2>
            <p className="mt-3">OSSMeet offers three subscription tiers:</p>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>
                <strong>Free ($0/month)</strong> — Up to 100 participants per meeting, 90-minute meeting duration limit, 1 GB cloud storage, and 30-day data retention.
              </li>
              <li>
                <strong>Pro ($5/user/month)</strong> — Up to 500 participants per meeting, unlimited meeting duration, 50 GB cloud storage, and 1-year data retention.
              </li>
              <li>
                <strong>Organization ($25/user/month)</strong> — Unlimited participants, unlimited meeting duration, unlimited cloud storage, and unlimited data retention.
              </li>
            </ul>
            <p className="mt-3">
              Paid subscriptions are billed on a recurring monthly basis through our payment processor, Paddle. By subscribing to a paid plan, you authorize recurring charges to your chosen payment method. You may cancel your subscription at any time; cancellation takes effect at the end of the current billing cycle. Refunds are handled in accordance with our refund policy and Paddle's terms. We reserve the right to modify pricing with at least 30 days' prior notice.
            </p>
          </section>

          {/* 5. Acceptable Use */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">5. Acceptable Use</h2>
            <p className="mt-3">You agree not to use OSSMeet to:</p>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>Violate any applicable law, regulation, or third-party rights.</li>
              <li>Transmit content that is unlawful, harmful, threatening, abusive, harassing, defamatory, obscene, or otherwise objectionable.</li>
              <li>Distribute malware, viruses, or any other malicious code.</li>
              <li>Attempt to gain unauthorized access to the Service, other accounts, or any related systems or networks.</li>
              <li>Interfere with or disrupt the integrity or performance of the Service.</li>
              <li>Use automated scripts, bots, or scraping tools to access the Service without prior written consent.</li>
              <li>Record participants without their knowledge or consent where required by law.</li>
            </ul>
            <p className="mt-3">
              We reserve the right to suspend or terminate accounts that violate these rules, with or without notice.
            </p>
          </section>

          {/* 6. Intellectual Property */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">6. Intellectual Property</h2>
            <p className="mt-3">
              The OSSMeet platform source code is released under the MIT license. You are free to use, modify, and distribute the code in accordance with that license. The OSSMeet name, logo, and branding are trademarks of OSSMeet Contributors and may not be used without prior written permission.
            </p>
            <p className="mt-3">
              You retain full ownership of all content you create, upload, or share through the Service, including recordings, transcripts, whiteboard content, chat messages, and exported documents.
            </p>
          </section>

          {/* 7. User Content & Data */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">7. User Content &amp; Data</h2>
            <p className="mt-3">
              You are solely responsible for the content you create and share through the Service. OSSMeet does not access, monitor, or review the content of your meetings, recordings, transcripts, or whiteboard sessions. We only access meeting metadata (such as room names, participant counts, and timestamps) necessary to operate the Service.
            </p>
            <p className="mt-3">
              Content stored on your behalf is retained according to your subscription plan (Free: 30 days, Pro: 1 year, Organization: unlimited). After the retention period expires, data may be automatically removed. You are responsible for exporting any content you wish to keep before the retention period ends.
            </p>
          </section>

          {/* 8. Privacy */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">8. Privacy</h2>
            <p className="mt-3">
              Your use of OSSMeet is also governed by our{" "}
              <Link to="/privacy" className="text-accent-700 underline">
                Privacy Policy
              </Link>
              , which describes how we collect, use, and protect your personal information. By using the Service, you consent to the data practices described in the Privacy Policy.
            </p>
          </section>

          {/* 9. Service Availability & Disclaimers */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">9. Service Availability &amp; Disclaimers</h2>
            <p className="mt-3">
              OSSMeet is provided on an "as is" and "as available" basis without warranties of any kind, whether express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Service will be uninterrupted, error-free, or secure, or that any defects will be corrected.
            </p>
            <p className="mt-3">
              We may perform scheduled or unscheduled maintenance that may temporarily affect availability. We will make reasonable efforts to provide advance notice of planned downtime.
            </p>
          </section>

          {/* 10. Limitation of Liability */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">10. Limitation of Liability</h2>
            <p className="mt-3">
              To the maximum extent permitted by applicable law, OSSMeet Contributors and their affiliates, officers, employees, agents, and licensors shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data, or goodwill, whether caused by tort (including negligence), breach of contract, or otherwise, arising out of or in connection with your use of the Service — even if advised of the possibility of such damages.
            </p>
            <p className="mt-3">
              Our total aggregate liability for any claims arising under these Terms shall not exceed the amount you have paid to OSSMeet in the twelve (12) months preceding the claim.
            </p>
          </section>

          {/* 11. Termination */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">11. Termination</h2>
            <p className="mt-3">
              You may terminate your account at any time by contacting us or through your account settings. We may suspend or terminate your access to the Service at any time, with or without cause, and with or without notice. Upon termination, your right to use the Service ceases immediately. Provisions of these Terms that by their nature should survive termination — including intellectual property, limitation of liability, and governing law — shall survive.
            </p>
          </section>

          {/* 12. Changes to Terms */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">12. Changes to Terms</h2>
            <p className="mt-3">
              We reserve the right to modify these Terms at any time. When we make material changes, we will update the "Last updated" date at the top of this page and, where practicable, notify you via email or through the Service. Your continued use of OSSMeet after changes take effect constitutes acceptance of the revised Terms.
            </p>
          </section>

          {/* 13. Governing Law */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">13. Governing Law</h2>
            <p className="mt-3">
              These Terms shall be governed by and construed in accordance with the laws of Singapore, without regard to its conflict-of-law principles. Any disputes arising from these Terms or the Service shall be resolved exclusively in the courts of Singapore.
            </p>
          </section>

          {/* 14. Contact Information */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">14. Contact Information</h2>
            <p className="mt-3">
              If you have any questions about these Terms, please contact us at{" "}
              <a href="mailto:support@ossmeet.com" className="text-accent-700 underline">
                support@ossmeet.com
              </a>
              .
            </p>
          </section>

          <p className="border-t border-neutral-200 pt-6 text-sm text-neutral-500">
            © 2026 OSSMeet Contributors. The OSSMeet source code is available under the MIT license.
          </p>
        </div>
      </main>
    </div>
  );
}
