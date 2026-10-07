package main

import "fmt"

func main() {
	var n int
	fmt.Scan(&n)
	sum := 0

	for i := 1; i <= n; i++ {
		if i%2 == 0 {
			sum += i
		} else {
			sum--
		}
	}

	for sum > 100 {
		sum -= 10
	}

	nums := []int{3, 1, 4}
	for _, v := range nums {
		sum += v
	}

	switch sum % 4 {
	case 0:
		fmt.Println("zero")
	case 1:
		fmt.Println("one")
	case 2:
		fmt.Println("two")
	default:
		fmt.Println("other")
	}

	if sum > 0 {
		fmt.Println(sum)
	}
}
