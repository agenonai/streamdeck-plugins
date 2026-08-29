# Manual verification checklist (k3s-context plugin)

This checklist covers the parts of Task 10 that cannot be done by an agent:
physically dragging keys onto a Stream Deck, pressing them, and watching the
result. Everything that could be verified without touching your real
`~/.kube/config` was already verified against a disposable copy in a
separate verification pass; see the Task 10 report in the planning
repository for that evidence (kubeconfig service tests, build, typecheck,
and the plugin process registering with the Stream Deck app).

Before you start, record your current context so you can restore it at the
end. The context recorded during this verification run was:

```
current-context: agenon-vn-2
```

If your current context has changed since then, run `kubectl config
current-context` now and use that value in step 8 instead.

## 1. Confirm the plugin is linked and visible

1. Do: open the Stream Deck app. Look for a "Kubernetes Context" category in
   the action list.
   See: the category appears with two actions, "Cycle Context" and "Pin
   Context". If it does not appear, quit and reopen the Stream Deck app once;
   the app only picks up a newly linked plugin's actions on its next scan.

## 2. Verify the cycle action

2. Do: drag "Cycle Context" onto an empty key. Open its property inspector
   (double-click the key) and check three contexts from the list, then close
   the property inspector.
   See: the key's title updates to show the currently active context.

3. Do: press the key once.
   See: the key title changes to the next checked context in the order you
   checked them.

4. Do: in a **new terminal window** (not the one you used for setup), run
   `kubectl config current-context`.
   See: it prints the same context name shown on the key.

5. Do: press the key two more times.
   See: the title cycles to the next checked context each time, and wraps
   back to the first checked context after the last one. Each press again
   matches `kubectl config current-context` in the terminal.

## 3. Verify the pin action

6. Do: drag two "Pin Context" keys onto empty keys. Open each one's property
   inspector and pin a different context to each (a different context per
   key), then close both property inspectors.
   See: exactly one of the two keys is lit (highlighted); the other is dim.
   The lit key is whichever context is currently active.

7. Do: press the dim key.
   See: within about a second, that key lights up and the previously lit key
   goes dim. `kubectl config current-context` in your terminal now reports
   the context you just pinned.

8. Do: press the now-lit key again.
   See: nothing happens. The key stays lit, the context does not change, and
   no error appears.

## 4. Verify external change detection

9. Do: in a terminal, run `kubectl config use-context <a context not
   currently shown as active on any key>`.
   See: within about a second, every key touching that context updates
   without you pressing anything: the cycle key's title changes if the new
   context is one of its checked contexts, and the correct pin key lights up
   if the new context is one of the two pinned contexts.

## 5. Kubeconfig integrity check

Read this section before running the diff below, the expected result is not
a clean diff.

During Task 10's automated verification, switching contexts through a copy
of your kubeconfig showed that the plugin's write path (via the `yaml`
library) re-serializes the whole file on its first write. On a kubeconfig
written by `kubectl` (sequence items flush against their parent key, for
example `- cluster:` at the start of the line), the plugin's rewrite adds
2-space indentation to every sequence item in the file. This happens once,
on the very first context switch the plugin makes; after that first write,
later switches keep reusing the newly-indented formatting. All cluster,
user, context, and namespace data is preserved exactly, only whitespace
changes. This means a raw `diff` against a backup will show many changed
lines, not zero, the first time you use the plugin.

10. Do: before doing anything else today, make a manual backup:

    ```bash
    cp ~/.kube/config ~/.kube/config.pre-streamdeck-$(date +%Y%m%d)
    kubectl config get-contexts | wc -l
    ```

    (Skip this if you already have a backup from earlier today.)

11. Do: after finishing steps 1 through 9 above, run:

    ```bash
    diff <(kubectl config get-contexts -o name | sort) \
         <(KUBECONFIG=~/.kube/config.pre-streamdeck-$(date +%Y%m%d) kubectl config get-contexts -o name | sort)
    kubectl config get-contexts | wc -l
    ```

    See: the `diff` prints nothing (the same set of context names exists in
    both files) and the line count matches what you recorded in step 10. This
    is the check that actually matters: no context was renamed, added, or
    deleted.

12. Do (optional, stronger check): confirm you can still reach a cluster you
    trust, for example:

    ```bash
    kubectl --context agenon-vn-2 version --request-timeout=3s
    ```

    See: it responds normally, proving the cluster and user credentials for
    that context were not corrupted by the reformatting.

13. Do (optional): if you want to see the raw formatting change for
    yourself:

    ```bash
    diff ~/.kube/config ~/.kube/config.pre-streamdeck-$(date +%Y%m%d) | head -20
    ```

    See: many lines differ, all of them whitespace-only indentation changes
    on `- cluster:`, `- context:`, `- name:` style list lines, plus the
    `current-context` line. If you see any line where actual data (a
    certificate, a server URL, a namespace, a username) differs and not just
    leading whitespace, stop and flag it, that would be a real problem worth
    investigating, unlike the expected reformatting above.

## 6. Restore

14. Do: restore your original context:

    ```bash
    kubectl config use-context agenon-vn-2
    ```

    (Replace `agenon-vn-2` with whatever `kubectl config current-context`
    reported before you started, if different.)

15. Do: remove the test keys from your Stream Deck profile if you do not
    want to keep them (drag them off, or right-click and remove).
