function printState(nums, slow, fast) {
    console.log("\nCurrent Positions");

    nums.forEach((next, i) => {
        let marker = "   ";

        if (i === slow && i === fast) marker = "🐢🐇";
        else if (i === slow) marker = "🐢 ";
        else if (i === fast) marker = "🐇 ";

        console.log(`${marker} ${i} ───▶ ${next}`);
    });
}

function findDuplicate(nums) {
    console.log("Input:", nums);

    console.log("\nGraph");
    nums.forEach((next, i) => {
        console.log(`${i} ───▶ ${next}`);
    });

    let slow = nums[0];
    let fast = nums[0];

    console.log("\n🐢 Slow starts at:", slow);
    console.log("🐇 Fast starts at:", fast);

    let step = 1;

    console.log("\n========== Phase 1 : Find Meeting Point ==========");

    do {
        const oldSlow = slow;
        const oldFast = fast;

        const slowNext = nums[oldSlow];
        const fastMiddle = nums[oldFast];
        const fastNext = nums[fastMiddle];

        console.log(`\nStep ${step}`);

        console.log(`🐢 Slow: ${oldSlow} -> ${slowNext}`);
        console.log(`🐇 Fast: ${oldFast} -> ${fastMiddle} -> ${fastNext}`);

        slow = slowNext;
        fast = fastNext;

        printState(nums, slow, fast);

        step++;
    } while (slow !== fast);

    console.log(`\n✅ Meeting Point = ${slow}`);

    console.log("\n========== Phase 2 : Find Duplicate ==========");

    slow = nums[0];

    console.log(`Reset 🐢 Slow = ${slow}`);
    console.log(`Keep  🐇 Fast = ${fast}`);

    step = 1;

    while (slow !== fast) {
        const oldSlow = slow;
        const oldFast = fast;

        slow = nums[slow];
        fast = nums[fast];

        console.log(`\nStep ${step}`);

        console.log(`🐢 Slow: ${oldSlow} -> ${slow}`);
        console.log(`🐇 Fast: ${oldFast} -> ${fast}`);

        printState(nums, slow, fast);

        step++;
    }

    console.log(`\n🎉 Duplicate Number = ${slow}`);

    return slow;
}

// Better example (meeting point != duplicate)
const nums = [2, 5, 9, 6, 9, 3, 8, 9, 7, 1];

findDuplicate(nums);