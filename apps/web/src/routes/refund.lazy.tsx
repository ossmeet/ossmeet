import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Video } from "lucide-react";

export const Route = createLazyFileRoute("/refund")({
  component: RefundPage,
});

function RefundPage() {
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
        <h1 className="text-2xl font-bold text-neutral-900">Refund Policy</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Last updated: April 23, 2026
        </p>

        <div className="mt-10 space-y-10 text-neutral-700 leading-relaxed">
          {/* 1. Overview */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">
              1. Overview
            </h2>
            <p className="mt-3">
              OSSMeet offers subscription-based plans (monthly and annual) that
              provide access to premium features such as longer meeting
              durations, higher participant limits, cloud recording,
              AI-powered transcription, and collaborative whiteboard sessions.
              This Refund Policy explains how cancellations and refunds are
              handled.
            </p>
          </section>

          {/* 2. Free Trial & Free Plan */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">
              2. Free Trial &amp; Free Plan
            </h2>
            <p className="mt-3">
              OSSMeet offers a free plan with limited features at no cost. We
              encourage you to try the free plan before upgrading to a paid
              subscription to ensure OSSMeet meets your needs. No payment
              information is required to use the free plan.
            </p>
          </section>

          {/* 3. Cancellation */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">
              3. Cancellation
            </h2>
            <p className="mt-3">
              You may cancel your subscription at any time from your account
              settings. When you cancel:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>
                Your subscription will remain active until the end of your
                current billing period.
              </li>
              <li>
                You will not be charged for the next billing cycle.
              </li>
              <li>
                After the billing period ends, your account will revert to the
                free plan.
              </li>
            </ul>
          </section>

          {/* 4. Refund Eligibility */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">
              4. Refund Eligibility
            </h2>
            <p className="mt-3">
              We want you to be satisfied with OSSMeet. If you are not happy
              with your purchase, you may request a refund under the following
              conditions:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>
                <strong>Within 14 days of purchase</strong> — If you request a
                refund within 14 days of your initial subscription purchase or
                renewal, we will issue a full refund, no questions asked.
              </li>
              <li>
                <strong>After 14 days</strong> — Refund requests made after 14
                days from the purchase or renewal date are evaluated on a
                case-by-case basis. We may offer a prorated refund or credit at
                our discretion.
              </li>
            </ul>
          </section>

          {/* 5. How to Request a Refund */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">
              5. How to Request a Refund
            </h2>
            <p className="mt-3">
              To request a refund, please contact us at{" "}
              <a
                href="mailto:support@ossmeet.com"
                className="text-accent-700 underline underline-offset-2 hover:text-accent-800"
              >
                support@ossmeet.com
              </a>{" "}
              with the following information:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>Your account email address</li>
              <li>Date of purchase</li>
              <li>Reason for the refund request</li>
            </ul>
            <p className="mt-3">
              We aim to process all refund requests within 5–10 business days.
              Approved refunds will be returned to your original payment method.
            </p>
          </section>

          {/* 6. Plan Changes */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">
              6. Plan Changes
            </h2>
            <p className="mt-3">
              If you upgrade your plan, the new pricing takes effect
              immediately and you will be charged a prorated amount for the
              remainder of your billing period. If you downgrade, the change
              takes effect at the start of your next billing cycle.
            </p>
          </section>

          {/* 7. Exceptions */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">
              7. Exceptions
            </h2>
            <p className="mt-3">
              Refunds will not be issued in the following cases:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>
                Accounts terminated for violation of our{" "}
                <Link
                  to="/terms"
                  className="text-accent-700 underline underline-offset-2 hover:text-accent-800"
                >
                  Terms of Service
                </Link>
              </li>
              <li>
                Failure to cancel before an automatic renewal (though you may
                still request a refund within 14 days of the renewal)
              </li>
            </ul>
          </section>

          {/* 8. Changes to This Policy */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">
              8. Changes to This Policy
            </h2>
            <p className="mt-3">
              We may update this Refund Policy from time to time. When we make
              changes, we will update the &quot;Last updated&quot; date at the
              top of this page. Your continued use of OSSMeet after any changes
              constitutes your acceptance of the updated policy.
            </p>
          </section>

          {/* 9. Contact Us */}
          <section>
            <h2 className="text-lg font-semibold text-neutral-900">
              9. Contact Us
            </h2>
            <p className="mt-3">
              If you have any questions about this Refund Policy, please
              contact us at:
            </p>
            <p className="mt-2">
              <a
                href="mailto:support@ossmeet.com"
                className="text-accent-700 underline underline-offset-2 hover:text-accent-800"
              >
                support@ossmeet.com
              </a>
            </p>
            <p className="mt-4 text-sm text-neutral-500">
              &copy; 2026 OSSMeet Contributors. OSSMeet is open-source software
              licensed under the MIT License.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
